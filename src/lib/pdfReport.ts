import { jsPDF } from 'jspdf';
import {
  CHECKLIST_STATUS_LABELS,
  parseExecutionMetadata,
  SCALE_CHECKLIST_ITEMS,
} from './fieldExecution';
import {
  getAttachmentTypeLabel,
  SIGNATURE_OMITTED_REASONS,
} from './fieldEvidence';
import type {
  Company,
  ServiceOrder,
  ServiceOrderAttachment,
  ServiceOrderExecution,
  ServiceOrderItem,
  ServiceOrderSignature,
} from '../types/database';

function hexToRgb(hex: string | undefined | null, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return fallback;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

async function fetchImageAsDataUrl(
  url: string
): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const format: 'PNG' | 'JPEG' = blob.type.includes('png') ? 'PNG' : 'JPEG';

    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    if (!dataUrl) return null;
    return { dataUrl, format };
  } catch {
    return null;
  }
}

export interface GeneratePdfParams {
  company: Company | null;
  order: ServiceOrder;
  execution: ServiceOrderExecution | null;
  items: ServiceOrderItem[];
  attachments: Array<ServiceOrderAttachment & { signedUrl?: string }>;
  clientSignature: (ServiceOrderSignature & { signedUrl?: string }) | null;
}

const STATUS_PT: Record<string, string> = {
  open: 'ABERTA',
  scheduled: 'AGENDADA',
  in_progress: 'EM EXECUÇÃO',
  completed: 'CONCLUÍDA',
  cancelled: 'CANCELADA',
};

export async function generateServiceOrderPdf(
  params: GeneratePdfParams
): Promise<{ blob: Blob; fileName: string }> {
  const { company, order, execution, items, attachments, clientSignature } = params;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  const headerColor = hexToRgb(company?.sidebar_color, [11, 37, 69]);
  const accentColor = hexToRgb(company?.primary_color, [13, 148, 136]);

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - 18) {
      doc.addPage();
      y = 16;
    }
  };

  const drawSectionTitle = (title: string) => {
    checkPageBreak(12);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y, contentWidth, 7, 1.2, 1.2, 'F');
    doc.setFillColor(...accentColor);
    doc.rect(margin, y, 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title.toUpperCase(), margin + 4.5, y + 4.8);
    y += 10;
  };

  // =========================================================================
  // 1. CABEÇALHO CORPORATIVO
  // =========================================================================
  doc.setFillColor(...headerColor);
  doc.rect(0, 0, pageWidth, 28, 'F');

  let logoOffsetX = margin;
  if (company?.logo_url) {
    const logoImg = await fetchImageAsDataUrl(company.logo_url);
    if (logoImg) {
      try {
        doc.addImage(logoImg.dataUrl, logoImg.format, margin, 4.5, 18, 18);
        logoOffsetX = margin + 21;
      } catch {
        // Ignora imagem incompatível
      }
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(company?.name || 'EA Balanças & Metrologia', logoOffsetX, 11.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const companyMeta = [
    company?.document_cnpj ? `CNPJ: ${company.document_cnpj}` : '',
    company?.phone ? `Tel: ${company.phone}` : '',
    company?.email || '',
  ]
    .filter(Boolean)
    .join('  •  ');
  doc.text(companyMeta || 'Relatório Técnico de Assistência & Metrologia', logoOffsetX, 17);
  doc.text(
    `Emitido em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
    logoOffsetX,
    22
  );

  // Badge Nº OS à direita
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`OS ${order.order_number}`, pageWidth - margin, 11.5, { align: 'right' });
  doc.setFontSize(8.5);
  doc.setTextColor(167, 243, 208);
  doc.text(
    STATUS_PT[order.status] || order.status.toUpperCase(),
    pageWidth - margin,
    17,
    { align: 'right' }
  );

  y = 34;

  // =========================================================================
  // 2. DADOS DO CLIENTE, EQUIPAMENTO E TÉCNICO
  // =========================================================================
  drawSectionTitle('Identificação do Cliente, Equipamento e Atendimento');

  const colW = (contentWidth - 4) / 2;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, colW, 28, 1.5, 1.5, 'S');
  doc.roundedRect(margin + colW + 4, y, colW, 28, 1.5, 1.5, 'S');

  // Coluna Cliente
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('CLIENTE / LOCAL', margin + 3, y + 5);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  const clientName = order.client?.trade_name || order.client?.name || 'Cliente';
  doc.text(doc.splitTextToSize(clientName, colW - 6)[0], margin + 3, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (order.client?.document_number) {
    doc.text(`Doc.: ${order.client.document_number}`, margin + 3, y + 15);
  }
  const unitText = order.unit
    ? `${order.unit.unit_name} — ${order.unit.street}${
        order.unit.street_number ? `, ${order.unit.street_number}` : ''
      }, ${order.unit.city}/${order.unit.state}`
    : 'Endereço principal';
  doc.text(doc.splitTextToSize(unitText, colW - 6), margin + 3, y + 20);

  // Coluna Equipamento
  const col2X = margin + colW + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('BALANÇA / EQUIPAMENTO', col2X + 3, y + 5);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  const equipTitle = order.equipment
    ? `${order.equipment.brand} ${order.equipment.model}`
    : 'Equipamento identificado em campo';
  doc.text(doc.splitTextToSize(equipTitle, colW - 6)[0], col2X + 3, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (order.equipment) {
    doc.text(
      `Série: ${order.equipment.serial_number}${
        order.equipment.asset_tag ? ` • TAG: ${order.equipment.asset_tag}` : ''
      }`,
      col2X + 3,
      y + 15
    );
    if (order.equipment.capacity_label) {
      doc.text(`Capacidade: ${order.equipment.capacity_label}`, col2X + 3, y + 19.5);
    }
  }
  doc.text(
    `Técnico: ${order.primary_technician?.full_name || 'Técnico em Campo'}`,
    col2X + 3,
    y + 24.5
  );

  y += 33;

  // =========================================================================
  // 3. TEMPOS DE CAMPO, GPS, LACRES E PARECER
  // =========================================================================
  const meta = parseExecutionMetadata(execution?.calibration_measurements);
  drawSectionTitle('Registro em Campo, Lacres e Parecer Técnico');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);

  const fmtDate = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : 'Não registrado';

  doc.text(`Início Deslocamento: ${fmtDate(meta.travel_started_at)}`, margin, y);
  doc.text(`Check-in no Cliente: ${fmtDate(meta.arrived_at)}`, margin + 92, y);
  y += 5;

  const gpsStr =
    execution?.checkin_latitude && execution?.checkin_longitude
      ? `${execution.checkin_latitude}, ${execution.checkin_longitude}`
      : 'Não capturado';
  doc.text(`Coordenadas GPS: ${gpsStr}`, margin, y);
  doc.text(
    `Conclusão OS: ${fmtDate(order.completed_at ?? execution?.finished_at)}`,
    margin + 92,
    y
  );
  y += 5;

  doc.text(`Lacre Retirado: ${execution?.removed_seal_number || '—'}`, margin, y);
  doc.text(`Novo Lacre Aplicado: ${execution?.applied_seal_number || '—'}`, margin + 92, y);
  y += 5;

  const approvalLabel =
    execution?.equipment_approved === true
      ? 'APROVADA PARA USO'
      : execution?.equipment_approved === false
      ? 'REPROVADA / REQUER INTERVENÇÃO'
      : 'EM ANÁLISE TÉCNICA';
  doc.setFont('helvetica', 'bold');
  doc.text(`Parecer Técnico: ${approvalLabel}`, margin, y);
  y += 7;

  // =========================================================================
  // 4. DEFEITO RELATADO, DIAGNÓSTICO E SERVIÇOS EXECUTADOS
  // =========================================================================
  drawSectionTitle('Solicitação, Diagnóstico e Serviços Executados');

  const writeParagraph = (label: string, text: string) => {
    checkPageBreak(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(label, margin, y);
    y += 4.2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text || 'Não informado.', contentWidth);
    checkPageBreak(lines.length * 4 + 3);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 3.5;
  };

  writeParagraph('Defeito Relatado:', order.reported_issue);
  writeParagraph('Diagnóstico Técnico Encontrado:', execution?.diagnosis || '');
  writeParagraph('Serviços Executados:', execution?.performed_services || '');

  // =========================================================================
  // 5. CHECKLIST METROLÓGICO
  // =========================================================================
  drawSectionTitle('Checklist Metrológico de Inspeção');

  for (const item of SCALE_CHECKLIST_ITEMS) {
    checkPageBreak(7);
    const val = meta.checklist[item.key];
    const statusLabel = val ? CHECKLIST_STATUS_LABELS[val] : 'Não respondido';

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(`• ${item.label}`, margin + 1, y);

    doc.setFont('helvetica', 'bold');
    if (val === 'ok') doc.setTextColor(5, 150, 105);
    else if (val === 'fail') doc.setTextColor(220, 38, 38);
    else if (val === 'attention') doc.setTextColor(217, 119, 6);
    else doc.setTextColor(100, 116, 139);

    doc.text(statusLabel, pageWidth - margin, y, { align: 'right' });
    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y + 1.5, pageWidth - margin, y + 1.5);
    y += 5.5;
  }
  y += 3;

  // =========================================================================
  // 6. PEÇAS & ORÇAMENTO DA OS
  // =========================================================================
  const activeItems = items.filter((i) => i.item_status !== 'rejected');
  if (activeItems.length > 0) {
    drawSectionTitle(`Peças e Serviços Vinculados (${activeItems.length})`);

    checkPageBreak(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('CÓD.', margin, y);
    doc.text('DESCRIÇÃO', margin + 18, y);
    doc.text('STATUS', margin + 115, y);
    doc.text('QTD', margin + 142, y, { align: 'right' });
    doc.text('TOTAL (R$)', pageWidth - margin, y, { align: 'right' });
    y += 3.5;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    let grandTotal = 0;
    const itemStatusPt: Record<string, string> = {
      proposed: 'Proposto',
      authorized: 'Autorizado',
      applied: 'Aplicado',
    };

    for (const item of activeItems) {
      checkPageBreak(7);
      grandTotal += Number(item.total_price || 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(item.item_code || '—', margin, y);
      const discPct = Number(item.discount_percent || 0);
      const discLabel =
        discPct > 0
          ? Number.isInteger(discPct)
            ? `${discPct}%`
            : `${discPct.toFixed(2).replace('.', ',')}%`
          : '';
      const descWithDiscount = discLabel
        ? `${item.description} (Desc. ${discLabel})`
        : item.description;
      const descLine = doc.splitTextToSize(descWithDiscount, 92)[0];
      doc.text(descLine, margin + 18, y);
      doc.text(itemStatusPt[item.item_status] || item.item_status, margin + 115, y);
      doc.text(String(item.quantity), margin + 142, y, { align: 'right' });
      doc.text(
        Number(item.total_price).toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        pageWidth - margin,
        y,
        { align: 'right' }
      );
      y += 5;
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      `TOTAL DE PEÇAS/SERVIÇOS: R$ ${grandTotal.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      pageWidth - margin,
      y,
      { align: 'right' }
    );
    y += 8;
  }

  // =========================================================================
  // 7. EVIDÊNCIAS FOTOGRÁFICAS
  // =========================================================================
  const photoAttachments = attachments.filter((a) => a.signedUrl);
  if (photoAttachments.length > 0) {
    drawSectionTitle(`Evidências Fotográficas (${photoAttachments.length})`);

    const imgW = (contentWidth - 6) / 2;
    const imgH = 48;

    for (let i = 0; i < photoAttachments.length; i += 2) {
      checkPageBreak(imgH + 12);

      for (let col = 0; col < 2; col++) {
        const att = photoAttachments[i + col];
        if (!att || !att.signedUrl) continue;

        const imgData = await fetchImageAsDataUrl(att.signedUrl);
        if (!imgData) continue;

        const xPos = margin + col * (imgW + 6);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(xPos, y, imgW, imgH + 7, 1.5, 1.5, 'S');

        try {
          doc.addImage(imgData.dataUrl, imgData.format, xPos + 1.5, y + 1.5, imgW - 3, imgH - 2);
        } catch {
          // Ignora falha pontual
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
        doc.text(getAttachmentTypeLabel(att.attachment_type), xPos + 3, y + imgH + 4.5);
      }

      y += imgH + 10;
    }
  }

  // =========================================================================
  // 8. ASSINATURA DIGITAL DO CLIENTE
  // =========================================================================
  drawSectionTitle('Assinatura de Recebimento e Conferência do Cliente');
  checkPageBreak(42);

  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, contentWidth, 34, 1.5, 1.5, 'S');

  if (clientSignature?.signedUrl) {
    const sigImg = await fetchImageAsDataUrl(clientSignature.signedUrl);
    if (sigImg) {
      try {
        doc.addImage(sigImg.dataUrl, sigImg.format, margin + 6, y + 2, 65, 22);
      } catch {
        // fallback sem imagem
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(clientSignature.signer_name, margin + 80, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Documento: ${clientSignature.signer_document || 'Não informado'}`,
      margin + 80,
      y + 15.5
    );
    doc.text(
      `Cargo/Vínculo: ${clientSignature.signer_role_label || 'Responsável no Cliente'}`,
      margin + 80,
      y + 21
    );
    doc.text(
      `Assinado digitalmente em ${fmtDate(clientSignature.signed_at)}`,
      margin + 80,
      y + 26.5
    );
  } else if (meta.signature_omitted_reason) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(180, 83, 9);
    doc.text('ASSINATURA NÃO COLETADA — JUSTIFICATIVA REGISTRADA', margin + 6, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Motivo: ${SIGNATURE_OMITTED_REASONS[meta.signature_omitted_reason] || meta.signature_omitted_reason}`,
      margin + 6,
      y + 15.5
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const notesLines = doc.splitTextToSize(
      `Detalhamento: ${meta.signature_omitted_notes || 'Não detalhado.'}`,
      contentWidth - 12
    );
    doc.text(notesLines.slice(0, 2), margin + 6, y + 21.5);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Assinatura digital não coletada até o momento.', margin + 6, y + 18);
  }

  // =========================================================================
  // 9. RODAPÉ EM TODAS AS PÁGINAS
  // =========================================================================
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${company?.name || 'EA Balanças'} • Relatório Técnico Metrion OS ${order.order_number}`,
      margin,
      pageHeight - 8
    );
    doc.text(`Página ${p} de ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    });
  }

  const blob = doc.output('blob');
  const safeOrderNum = order.order_number.replace(/[^a-z0-9-_]/gi, '_');
  const fileName = `Relatorio_${safeOrderNum}.pdf`;

  return { blob, fileName };
}

/**
 * Baixa o PDF gerado para o dispositivo do usuário.
 */
export function downloadPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Compartilha o relatório PDF pelo WhatsApp usando Web Share API (mobile com arquivo anexo)
 * ou realizando download + abertura de link WhatsApp Web/App com resumo seguro.
 */
export async function sharePdfViaWhatsApp(params: {
  blob: Blob;
  fileName: string;
  order: ServiceOrder;
  companyName: string;
}): Promise<{ method: 'native_file_share' | 'whatsapp_link_and_download' }> {
  const { blob, fileName, order, companyName } = params;
  const pdfFile = new File([blob], fileName, { type: 'application/pdf' });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const osLink = `${origin}/tecnico/os/${order.id}`;
  const clientName = order.client?.trade_name || order.client?.name || 'Cliente';
  const summaryText =
    `*${companyName} — Relatório Técnico OS #${order.order_number}*\n` +
    `Cliente: ${clientName}\n` +
    `Equipamento: ${
      order.equipment
        ? `${order.equipment.brand} ${order.equipment.model} (${order.equipment.serial_number})`
        : 'Identificado em campo'
    }\n` +
    `Link seguro do atendimento: ${osLink}`;

  // Em smartphones (Android/iOS), tenta compartilhar o arquivo PDF diretamente para o WhatsApp
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [pdfFile] })
  ) {
    try {
      await navigator.share({
        files: [pdfFile],
        title: `Relatório OS ${order.order_number}`,
        text: summaryText,
      });
      return { method: 'native_file_share' };
    } catch {
      // Usuário cancelou ou navegador bloqueou share; segue para fallback
    }
  }

  // Fallback seguro: baixa o PDF e abre o WhatsApp com mensagem estruturada e link
  downloadPdfBlob(blob, fileName);
  const cleanPhone = order.client?.phone?.replace(/\D/g, '') || '';
  const waUrl = cleanPhone
    ? `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(
        `${summaryText}\n\n_(O PDF ${fileName} foi baixado no dispositivo para ser anexado nesta conversa)_`
      )}`
    : `https://wa.me/?text=${encodeURIComponent(
        `${summaryText}\n\n_(O PDF ${fileName} foi baixado no dispositivo para ser anexado nesta conversa)_`
      )}`;

  window.open(waUrl, '_blank');
  return { method: 'whatsapp_link_and_download' };
}
