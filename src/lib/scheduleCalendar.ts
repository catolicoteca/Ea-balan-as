import type { OSStatus, ServiceOrder } from '../types/database';

export interface CalendarDayCell {
  dateKey: string; // YYYY-MM-DD (local)
  date: Date;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

const NON_DRAGGABLE_STATUSES: ReadonlySet<OSStatus> = new Set<OSStatus>([
  'completed',
  'cancelled',
]);

export function formatDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toLocalDateKey(isoOrDate: string | Date): string {
  const dt = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(dt.getTime())) return '';
  return formatDateKeyLocal(dt);
}

export function getMonthGridDays(
  year: number,
  monthIndex: number,
  todayRef: Date = new Date()
): CalendarDayCell[] {
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const startWeekday = firstDayOfMonth.getDay(); // 0 = Domingo .. 6 = Sábado
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = startWeekday + daysInMonth > 35 ? 42 : 35;

  const todayKey = formatDateKeyLocal(todayRef);
  const gridStart = new Date(year, monthIndex, 1 - startWeekday);

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + i
    );
    const dateKey = formatDateKeyLocal(cellDate);
    cells.push({
      dateKey,
      date: cellDate,
      dayNumber: cellDate.getDate(),
      inCurrentMonth:
        cellDate.getFullYear() === year && cellDate.getMonth() === monthIndex,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}

/**
 * Move o agendamento para uma nova data local (YYYY-MM-DD), preservando
 * exatamente o horário de início e a duração original entre scheduled_start e scheduled_end.
 */
export function shiftScheduledRangeToDate(
  scheduledStartIso: string,
  scheduledEndIso: string | null | undefined,
  targetDateKey: string
): { scheduled_start: string; scheduled_end: string | null } {
  const start = new Date(scheduledStartIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Data/horário inicial inválido para reagendamento.');
  }

  const [yStr, mStr, dStr] = targetDateKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr) - 1;
  const day = Number(dStr);
  if (!year || month < 0 || !day) {
    throw new Error('Data de destino inválida.');
  }

  const newStart = new Date(
    year,
    month,
    day,
    start.getHours(),
    start.getMinutes(),
    start.getSeconds(),
    start.getMilliseconds()
  );

  let newEndIso: string | null = null;
  if (scheduledEndIso) {
    const oldEnd = new Date(scheduledEndIso);
    if (!Number.isNaN(oldEnd.getTime())) {
      const durationMs = oldEnd.getTime() - start.getTime();
      const newEnd = new Date(newStart.getTime() + Math.max(0, durationMs));
      newEndIso = newEnd.toISOString();
    }
  }

  return {
    scheduled_start: newStart.toISOString(),
    scheduled_end: newEndIso,
  };
}

export function isDraggableServiceOrder(
  order: Pick<ServiceOrder, 'status' | 'scheduled_start'>,
  canReschedule: boolean
): boolean {
  if (!canReschedule || !order.scheduled_start) return false;
  return !NON_DRAGGABLE_STATUSES.has(order.status);
}

/**
 * Detecta gesto horizontal de troca de mês no toque móvel sem capturar
 * rolagens verticais normais da página.
 */
export function detectHorizontalMonthSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minDistancePx = 60
): 'prev' | 'next' | null {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < minDistancePx) return null;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  // Arrastar da direita para esquerda -> próximo mês; esquerda para direita -> mês anterior
  return dx < 0 ? 'next' : 'prev';
}
