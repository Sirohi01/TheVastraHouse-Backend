export type SkuInput = {
  prefix?: string;
  productSlug: string;
  color?: string;
  size?: string;
  sequence: number;
};

export function generateSku({
  prefix = "TVH",
  productSlug,
  color,
  size,
  sequence,
}: SkuInput): string {
  const productPart = productSlug
    .split("-")
    .map((part) => part.slice(0, 3).toUpperCase())
    .join("")
    .slice(0, 10);
  const colorPart = color ? normalizeSkuPart(color, 4) : "GEN";
  const sizePart = size ? normalizeSkuPart(size, 4) : "STD";
  const sequencePart = String(sequence).padStart(4, "0");

  return `${prefix}-${productPart}-${colorPart}-${sizePart}-${sequencePart}`;
}

export function generateBarcode(sku: string): string {
  const numeric = sku
    .split("")
    .map((character) => character.charCodeAt(0))
    .join("")
    .slice(0, 11)
    .padEnd(11, "0");
  const checksum = numeric
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

  return `${numeric}${(10 - (checksum % 10)) % 10}`;
}

function normalizeSkuPart(value: string, length: number): string {
  return (
    value
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase()
      .slice(0, length) || "NA"
  );
}
