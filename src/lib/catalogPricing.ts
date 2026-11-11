import type { PaymentModality } from '../types/database';

export type DiscountSource = 'item' | 'company' | 'none';

export interface CatalogPricingInput {
  baseCash: number;
  baseTerm: number;
  itemDiscountCash?: number | null;
  itemDiscountTerm?: number | null;
  companyDiscountCash?: number | null;
  companyDiscountTerm?: number | null;
  modality: PaymentModality;
  quantity?: number;
}

export interface ResolvedCatalogPricing {
  basePrice: number;
  discountPercent: number;
  discountSource: DiscountSource;
  finalUnitPrice: number;
  discountAmountPerUnit: number;
  lineTotal: number;
  lineDiscountTotal: number;
}

function round2(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  const num = Number(value);
  return Math.min(100, Math.max(0, round2(num)));
}

/**
 * Resolve o preço-base, o desconto comercial autorizado (%) e o preço final
 * para uma modalidade de pagamento específica, respeitando exceção por item
 * sobre o desconto padrão da empresa sem alterar permanentemente o preço-base.
 */
export function resolveCatalogItemPricing(
  input: CatalogPricingInput
): ResolvedCatalogPricing {
  const basePrice = round2(
    input.modality === 'cash' ? input.baseCash : input.baseTerm
  );

  const itemOverride = clampPercent(
    input.modality === 'cash' ? input.itemDiscountCash : input.itemDiscountTerm
  );
  const companyDefault = clampPercent(
    input.modality === 'cash' ? input.companyDiscountCash : input.companyDiscountTerm
  );

  let discountPercent = 0;
  let discountSource: DiscountSource = 'none';

  if (itemOverride !== null) {
    discountPercent = itemOverride;
    discountSource = itemOverride > 0 ? 'item' : 'none';
  } else if (companyDefault !== null && companyDefault > 0) {
    discountPercent = companyDefault;
    discountSource = 'company';
  }

  const finalUnitPrice = round2(basePrice * (1 - discountPercent / 100));
  const discountAmountPerUnit = round2(Math.max(0, basePrice - finalUnitPrice));
  const qty = input.quantity && input.quantity > 0 ? input.quantity : 1;

  return {
    basePrice,
    discountPercent,
    discountSource,
    finalUnitPrice,
    discountAmountPerUnit,
    lineTotal: round2(finalUnitPrice * qty),
    lineDiscountTotal: round2(discountAmountPerUnit * qty),
  };
}

export function formatDiscountPercent(percent: number | null | undefined): string {
  const num = Number(percent || 0);
  if (Number.isInteger(num)) return `${num}%`;
  return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}
