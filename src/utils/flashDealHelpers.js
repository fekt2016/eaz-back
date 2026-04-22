const slugify = (title) => {
  if (!title || typeof title !== 'string') return 'flash-deal';
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'flash-deal';
};

const roundMoney = (n) => Math.round(Number(n) * 100) / 100;

const computeFlashPrice = (originalPrice, discountType, discountValue) => {
  const orig = Number(originalPrice);
  if (!Number.isFinite(orig) || orig <= 0) return null;
  let fp;
  if (discountType === 'percentage') {
    fp = orig * (1 - Number(discountValue) / 100);
  } else {
    fp = orig - Number(discountValue);
  }
  return roundMoney(fp);
};

const effectiveDiscountPercent = (originalPrice, flashPrice) => {
  const orig = Number(originalPrice);
  const fp = Number(flashPrice);
  if (!Number.isFinite(orig) || orig <= 0 || !Number.isFinite(fp)) return 0;
  return ((orig - fp) / orig) * 100;
};

module.exports = {
  slugify,
  roundMoney,
  computeFlashPrice,
  effectiveDiscountPercent,
};
