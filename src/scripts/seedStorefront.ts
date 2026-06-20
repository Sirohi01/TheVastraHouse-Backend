import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Brand } from "../models/Brand.js";
import { Category } from "../models/Category.js";
import { CmsContent } from "../models/CmsContent.js";
import { Collection } from "../models/Collection.js";
import { Currency } from "../models/Currency.js";
import { Product } from "../models/Product.js";
import { ProductReview } from "../models/ProductReview.js";
import { Tag } from "../models/Tag.js";
import { Warehouse } from "../models/Warehouse.js";
import { upsertStockLedger } from "../services/inventoryService.js";
import { generateBarcode, generateSku } from "../services/skuService.js";

const imageUrl = "/images/home-hero.jpg";
const now = new Date();
const preOrderStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const preOrderEnd = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
const dispatchAt = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);
const deliveryAt = new Date(now.getTime() + 42 * 24 * 60 * 60 * 1000);

const categories = [
  ["Tops", "tops", "Everyday embroidered tops and relaxed premium separates."],
  ["Suits", "suits", "Coordinated suit sets crafted for festive and work occasions."],
  ["Co-ord Sets", "co-ord-sets", "Modern matching sets with refined Indian detailing."],
  ["Dresses", "dresses", "Easy statement dresses with graceful embroidery and drape."],
] as const;

const collections = [
  [
    "Ethereal Whites",
    "ethereal-whites",
    "Ivory, cream, and soft white styles with delicate craft.",
  ],
  ["Royal Heritage", "royal-heritage", "Deep festive tones and heirloom-inspired embroideries."],
  ["Modern Muse", "modern-muse", "Fresh colors, cleaner lines, and everyday elegance."],
] as const;

const tags = ["New Arrival", "Best Seller", "Limited Edition", "Festive", "Pre Order"] as const;

type ProductTag = (typeof tags)[number];
type ProductSeed = {
  category: string;
  collection: string;
  color: string;
  name: string;
  preOrder?: boolean;
  price: number;
  salePrice?: number;
  slug: string;
  tags: ProductTag[];
};

const products: ProductSeed[] = [
  {
    category: "suits",
    collection: "ethereal-whites",
    color: "Ivory",
    name: "Floral Chanderi Suit Set",
    price: 2899,
    slug: "floral-chanderi-suit-set",
    tags: ["New Arrival", "Festive"],
  },
  {
    category: "tops",
    collection: "royal-heritage",
    color: "Rose",
    name: "Embroidered Straight Kurta",
    price: 1899,
    salePrice: 1699,
    slug: "embroidered-straight-kurta",
    tags: ["Best Seller"],
  },
  {
    category: "suits",
    collection: "ethereal-whites",
    color: "Cream",
    name: "Handloom Silk Suit Set",
    preOrder: true,
    price: 4299,
    slug: "handloom-silk-suit-set",
    tags: ["Limited Edition", "Pre Order"],
  },
  {
    category: "co-ord-sets",
    collection: "royal-heritage",
    color: "Black",
    name: "Printed Co-ord Set",
    price: 2499,
    slug: "printed-co-ord-set",
    tags: ["Best Seller"],
  },
  {
    category: "tops",
    collection: "modern-muse",
    color: "Sage",
    name: "Cotton Printed Kurta",
    price: 1299,
    slug: "cotton-printed-kurta",
    tags: ["New Arrival"],
  },
  {
    category: "suits",
    collection: "modern-muse",
    color: "Mint",
    name: "Embroidered Organza Suit",
    price: 3299,
    slug: "embroidered-organza-suit",
    tags: ["Festive"],
  },
  {
    category: "dresses",
    collection: "royal-heritage",
    color: "Mustard",
    name: "A-Line Embroidered Dress",
    price: 2199,
    salePrice: 1999,
    slug: "a-line-embroidered-dress",
    tags: ["New Arrival"],
  },
  {
    category: "tops",
    collection: "ethereal-whites",
    color: "Pearl",
    name: "Linen Blend Top",
    price: 1399,
    slug: "linen-blend-top",
    tags: ["Limited Edition"],
  },
];

async function seedStorefront() {
  await mongoose.connect(env.MONGODB_URI);

  await Currency.findOneAndUpdate(
    { code: "INR" },
    { $set: { active: true, code: "INR", decimalPrecision: 0, symbol: "Rs." } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  );

  const brand = await Brand.findOneAndUpdate(
    { slug: "vastra-house" },
    {
      $set: {
        active: true,
        name: "The Vastra House",
        settings: {
          defaultCurrencyCode: "INR",
          supportEmail: "hello@thevastrahouse.com",
          timezone: "Asia/Kolkata",
        },
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  );

  const warehouse = await Warehouse.findOneAndUpdate(
    { brandId: brand._id, name: "Main Fulfilment Studio" },
    {
      $set: {
        active: true,
        address: {
          city: "Jaipur",
          countryCode: "IN",
          fullName: "The Vastra House",
          line1: "Vastra House Operations Studio",
          phone: "+910000000000",
          postalCode: "302001",
          region: "Rajasthan",
        },
        brandId: brand._id,
        name: "Main Fulfilment Studio",
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  );

  const categoryDocs = new Map<string, { _id: mongoose.Types.ObjectId; name: string }>();
  for (const [name, slug, description] of categories) {
    const category = await Category.findOneAndUpdate(
      { slug },
      {
        $set: {
          active: true,
          banner: media(`${name} category image for The Vastra House`, "1:1"),
          description,
          name,
          seo: {
            description,
            title: `${name} | The Vastra House`,
          },
          slug,
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
    categoryDocs.set(slug, { _id: category._id, name });
  }

  const collectionDocs = new Map<string, { _id: mongoose.Types.ObjectId; name: string }>();
  for (const [name, slug, description] of collections) {
    const collection = await Collection.findOneAndUpdate(
      { brandId: brand._id, slug },
      {
        $set: {
          active: true,
          banner: media(`${name} collection image for The Vastra House`, "1:1"),
          brandId: brand._id,
          description,
          name,
          seo: {
            description,
            title: `${name} | The Vastra House`,
          },
          slug,
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
    collectionDocs.set(slug, { _id: collection._id, name });
  }

  const tagDocs = new Map<string, mongoose.Types.ObjectId>();
  for (const name of tags) {
    const slug = slugify(name);
    const tag = await Tag.findOneAndUpdate(
      { slug },
      { $set: { active: true, name, slug } },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
    tagDocs.set(name, tag._id);
  }

  const productDocs = [];
  for (const [index, product] of products.entries()) {
    const category = categoryDocs.get(product.category);
    const collection = collectionDocs.get(product.collection);
    const tagIds = product.tags.map((tag) => tagDocs.get(tag)).filter(Boolean);

    const doc = await Product.findOneAndUpdate(
      { brandId: brand._id, slug: product.slug },
      {
        $set: {
          active: true,
          badgeOverrides: {
            bestSeller: product.tags.includes("Best Seller"),
            limitedEdition: product.tags.includes("Limited Edition"),
            newArrival: product.tags.includes("New Arrival"),
            trending: index < 3,
          },
          brandId: brand._id,
          categoryIds: category ? [category._id] : [],
          collectionIds: collection ? [collection._id] : [],
          computedBadges: {
            bestSeller: product.tags.includes("Best Seller"),
            limitedEdition: product.tags.includes("Limited Edition"),
            newArrival: product.tags.includes("New Arrival"),
            trending: index < 3,
          },
          description: `${product.name} is a premium ${category?.name.toLowerCase() ?? "style"} designed with heritage-inspired embroidery, comfortable fabric, and polished finishing for modern Indian wardrobes.`,
          fabricDetails: "Premium cotton blend with soft lining and detailed embroidery.",
          gstRate: 5,
          highlights: [
            "Meaningful alt-tag ready product media",
            "Comfort-first occasion silhouette",
            "Designed for repeat wear",
          ],
          hsnCode: "6204",
          media: [media(`${product.name} product image on The Vastra House`, "1:1")],
          merchandisingMetrics: {
            sales7d: 8 - index,
            trendingScore: 90 - index * 6,
            unitsSold30d: 80 - index * 7,
            views7d: 300 - index * 16,
          },
          name: product.name,
          seo: {
            description: `${product.name} from The Vastra House.`,
            title: `${product.name} | The Vastra House`,
          },
          shortDescription: `Premium ${product.color.toLowerCase()} style with refined embroidery.`,
          sizeGuide: "Available in XS to XXL. Choose your usual size for a comfortable fit.",
          sizeGuideMedia: media(`${product.name} size guide measurement chart`, "16:9"),
          slug: product.slug,
          tagIds,
          variants: ["XS", "S", "M", "L", "XL"].map((size, variantIndex) => {
            const sku = generateSku({
              color: product.color,
              productSlug: product.slug,
              sequence: variantIndex + 1,
              size,
            });

            return {
              active: true,
              barcode: generateBarcode(sku),
              basePrice: product.price,
              costPrice: Math.round(product.price * 0.45),
              color: product.color,
              currencyCode: "INR",
              media: [media(`${product.name} ${product.color} ${size} variant image`, "1:1")],
              preOrder: product.preOrder
                ? {
                    advancePercent: 40,
                    enabled: true,
                    endAt: preOrderEnd,
                    expectedDeliveryAt: deliveryAt,
                    expectedDispatchAt: dispatchAt,
                    paymentMode: "advance",
                    quantityCap: 25,
                    remainingQuantity: 25,
                    startAt: preOrderStart,
                  }
                : { enabled: false, quantityCap: 0, remainingQuantity: 0 },
              salePrice: product.salePrice,
              size,
              sku,
              stockPlaceholder: 12 + index,
            };
          }),
          washCare: "Gentle hand wash separately. Dry in shade. Use low iron on reverse.",
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
    productDocs.push(doc);
  }

  const productIds = productDocs.map((product) => product._id);
  for (const product of productDocs) {
    const related = productIds.filter((id) => !id.equals(product._id)).slice(0, 4);
    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          completeTheLookIds: related.slice(0, 2),
          frequentlyBoughtTogetherIds: related.slice(1, 3),
          recommendedProductIds: related.slice(0, 4),
          relatedProductIds: related.slice(0, 4),
        },
      },
    );
  }

  await seedReviews(productDocs);
  await seedInventoryLedgers(productDocs, String(warehouse._id));
  await seedCms();

  console.info("Storefront seed complete.");
  console.info(`Brand: ${brand.name}`);
  console.info(`Categories: ${categoryDocs.size}`);
  console.info(`Collections: ${collectionDocs.size}`);
  console.info(`Products: ${productDocs.length}`);
  console.info(`Inventory ledgers: ${productDocs.length * 5}`);
}

async function seedInventoryLedgers(
  productDocs: Array<{
    variants?: Array<{ sku?: string; stockPlaceholder?: number }>;
  }>,
  warehouseId: string,
) {
  for (const product of productDocs) {
    for (const variant of product.variants ?? []) {
      if (!variant.sku) {
        continue;
      }

      await upsertStockLedger({
        actor: { actorType: "system" },
        available: variant.stockPlaceholder ?? 10,
        damaged: 0,
        incoming: 0,
        lowStockThreshold: 3,
        reserved: 0,
        returned: 0,
        sku: variant.sku,
        warehouseId,
      });
    }
  }
}

async function seedReviews(productDocs: Array<{ _id: mongoose.Types.ObjectId; name: string }>) {
  for (const product of productDocs.slice(0, 4)) {
    await ProductReview.findOneAndUpdate(
      { guestEmail: `review-${String(product._id)}@seed.local`, productId: product._id },
      {
        $set: {
          body: `${product.name} feels premium and the product finish matches the catalog presentation.`,
          guestEmail: `review-${String(product._id)}@seed.local`,
          guestName: "Vastra Customer",
          moderationStatus: "approved",
          moderatedAt: now,
          productId: product._id,
          rating: 5,
          title: "Beautiful finish",
          verifiedPurchase: true,
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
  }
}

async function seedCms() {
  await CmsContent.findOneAndUpdate(
    { key: "storefront-main" },
    {
      $set: {
        about: {
          description:
            "The Vastra House brings timeless Indian wear into a polished modern commerce experience, with thoughtful cataloging, reliable operations, and premium presentation.",
          eyebrow: "Our Story",
          media: media("The Vastra House embroidered ethnic wear story image", "16:9"),
          primaryCta: { enabled: true, href: "/shop", label: "Explore Shop" },
          storyCopy:
            "We design for customers who want familiar craft language with a cleaner, more international shopping experience. From product media to checkout, each touchpoint is built to feel calm, premium, and practical.",
          storyEyebrow: "The Vastra House",
          storyTitle: "Clothing that feels rooted, refined, and ready.",
          title: "Crafted With Passion, Worn With Pride",
          values: [
            {
              icon: "sparkles",
              text: "Classic Indian silhouettes shaped for daily confidence and occasion dressing.",
              title: "Heritage First",
            },
            {
              icon: "award",
              text: "Every range is planned around fabric handfeel, fall, durability, and finish.",
              title: "Fabric-Led Quality",
            },
            {
              icon: "shield",
              text: "Clear product information, secure checkout, and transparent order tracking.",
              title: "Honest Commerce",
            },
            {
              icon: "care",
              text: "Support workflows are built into the platform from order to return.",
              title: "Customer Care",
            },
          ],
        },
        faqs: [
          {
            answer: "Orders above Rs. 1999 qualify for free shipping.",
            question: "Is shipping free?",
          },
          {
            answer: "Pre-order timelines are shown on the product page before checkout.",
            question: "How do pre-orders work?",
          },
        ],
        footer: {
          links: [
            { enabled: true, href: "/shop", label: "Shop" },
            { enabled: true, href: "/pre-order", label: "Pre-Order" },
            { enabled: true, href: "/track-order", label: "Track Order" },
          ],
          tagline: "Premium Indian wear, thoughtfully presented.",
        },
        home: {
          announcement: "Free shipping on orders above Rs. 1999",
          hero: {
            copy: "Premium tops, suits and clothing crafted for the modern you.",
            eyebrow: "New Season Edit",
            media: media("The Vastra House home hero banner", "16:9"),
            primaryCta: { enabled: true, href: "/shop", label: "Shop New Arrivals" },
            secondaryCta: { enabled: true, href: "/about", label: "Our Story" },
            slides: [
              {
                copy: "Premium tops, suits and clothing crafted for the modern you.",
                eyebrow: "New Season Edit",
                fontFamily: "serif",
                fontSize: "lg",
                media: media("The Vastra House home hero banner", "16:9"),
                primaryCta: { enabled: true, href: "/shop", label: "Shop New Arrivals" },
                secondaryCta: { enabled: true, href: "/about", label: "Our Story" },
                textColor: "#ffffff",
                title: "Timeless Style, Rooted in Heritage",
              },
              {
                copy: "Soft occasion wear with polished details and modern comfort.",
                eyebrow: "Festive Edit",
                fontFamily: "serif",
                fontSize: "md",
                media: media("The Vastra House festive hero slide", "16:9"),
                primaryCta: {
                  enabled: true,
                  href: "/collections/royal-heritage",
                  label: "Explore Collection",
                },
                secondaryCta: { enabled: true, href: "/pre-order", label: "Pre-Order" },
                textColor: "#ffffff",
                title: "Crafted For Celebration",
              },
            ],
            title: "Timeless Style, Rooted in Heritage",
          },
        },
        navigation: [
          { enabled: true, href: "/shop", label: "Shop" },
          { enabled: true, href: "/shop?sort=-newest", label: "New Arrivals" },
          { enabled: true, href: "/shop?sort=-bestSelling", label: "Best Sellers" },
          { enabled: true, href: "/about", label: "About" },
          { enabled: true, href: "/pre-order", label: "Pre-Order" },
          { enabled: true, href: "/track-order", label: "Track Order" },
        ],
        policies: [
          {
            body: "Shipping timelines vary by product availability and delivery location.",
            slug: "shipping",
            title: "Shipping Policy",
          },
          {
            body: "Return eligibility depends on product condition, order status, and policy window.",
            slug: "returns",
            title: "Returns Policy",
          },
        ],
        status: "published",
        testimonials: [
          {
            location: "Jaipur",
            name: "Aarohi",
            quote: "The shopping experience feels premium and the product detail is clear.",
          },
          {
            location: "Delhi",
            name: "Meera",
            quote: "The collection styling is elegant and easy to browse.",
          },
        ],
        title: "Storefront Main Content",
      },
    },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  );
}

function media(altText: string, aspectRatio: "1:1" | "16:9") {
  return {
    altText,
    aspectRatio,
    objectFit: "cover" as const,
    type: "image" as const,
    url: imageUrl,
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

seedStorefront()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
