import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BlogAuthor, BlogCategory, BlogPost } from "../models/Blog.js";
import { Product } from "../models/Product.js";
import {
  estimateReadingMinutes,
  htmlToPlainText,
  sanitizeRichHtml,
} from "../services/htmlSanitizer.js";

/**
 * One-off: publishes the first four help articles on the blog.
 *
 *   npm run db:backup                              # always take a backup first
 *   tsx src/scripts/blogSeedMigration.ts             # dry run
 *   tsx src/scripts/blogSeedMigration.ts --apply     # writes
 *
 * Content rules: store facts come only from the store's own policies, FAQ, size guide and
 * product care text; everything else is general fabric-care or styling advice. Idempotent:
 * authors, categories and articles are matched by slug and never overwritten.
 */
const APPLY = process.argv.includes("--apply");
const log = (message: string) => console.info(`${APPLY ? "[apply]" : "[dry-run]"} ${message}`);

const AUTHOR = {
  bio: "Style, sizing and care notes from the team at The Vastra House.",
  name: "The Vastra House Team",
  slug: "the-vastra-house-team",
};

const CATEGORIES = [
  {
    description: "Choosing your size and understanding fit.",
    name: "Size & Fit",
    slug: "size-and-fit",
  },
  {
    description: "Washing, drying and looking after your kurtis.",
    name: "Fabric Care",
    slug: "fabric-care",
  },
  { description: "Ideas for wearing kurtis and co-ord sets.", name: "Styling", slug: "styling" },
  {
    description: "How ordering, pre-orders and delivery work.",
    name: "Shopping Guides",
    slug: "shopping-guides",
  },
];

type Article = {
  category: string;
  content: string;
  faqs: Array<{ answer: string; question: string }>;
  productSlugs: string[];
  seoDescription: string;
  seoTitle: string;
  slug: string;
  tags: string[];
  title: string;
};

const ARTICLES: Article[] = [
  {
    category: "size-and-fit",
    slug: "how-to-choose-your-kurti-size",
    title: "How to Choose Your Kurti Size",
    seoTitle: "How to Choose Your Kurti Size: Measuring Guide",
    seoDescription:
      "Measure your bust, waist, hip, shoulder and length at home, compare with a size chart, and choose between two sizes with confidence.",
    tags: ["size guide", "kurti", "fit"],
    productSlugs: ["olive-blossom-co-ord-set", "premium-pink-floral-sleeveless-kurti"],
    content: `
<p><strong>The quickest way to pick a kurti size is to measure your bust, waist and hips in inches and match them to the size chart, then choose the larger size if you are in between and want a relaxed fit.</strong> It takes about five minutes and avoids most size-related returns.</p>

<h2>What you need</h2>
<p>A soft measuring tape and a mirror. Measure over light clothing, stand relaxed and keep the tape snug but not tight.</p>

<h2>The five measurements</h2>
<ul>
<li><strong>Bust:</strong> around the fullest part of your bust.</li>
<li><strong>Waist:</strong> around the narrowest part of your waist.</li>
<li><strong>Hip:</strong> around the fullest part of your hips.</li>
<li><strong>Shoulder:</strong> from one shoulder end to the other.</li>
<li><strong>Length:</strong> from the highest point of the shoulder down to where you want the hem to fall.</li>
</ul>

<h2>How do I match my measurements to a size?</h2>
<p>Compare your bust, waist and hip with the rows in our <a href="/pages/size-guide">size guide</a>, which lists sizes XS to 3XL with all measurements in inches. Bust is usually the number that decides a kurti size, so start there and then check the hip, especially for straight-fit styles and co-ord sets with trousers.</p>

<h2>What if I am between two sizes?</h2>
<p>Garment measurements can vary by about 1 inch. If you like a relaxed, comfortable fit, choose the larger size. If you prefer a closer fit and your measurements sit at the lower size, stay with the smaller one.</p>

<h2>Do all styles fit the same way?</h2>
<p>The size chart is a general guide, and individual styles can differ slightly because garments are measured by hand. A straight-fit kurti, a sleeveless kurti and a wide-leg trouser set will each feel a little different, so read the size notes on the product page. You can also email support@thevastrahouse.co.in if you want help with a specific style.</p>

<h2>Ready to choose?</h2>
<p>Browse the current styles in <a href="/shop">the shop</a>, such as the <a href="/shop/olive-blossom-co-ord-set">Olive Blossom Co-ord Set</a> or the <a href="/shop/premium-pink-floral-sleeveless-kurti">Premium Pink Floral Sleeveless Kurti</a>. If a size does not work, you can request a return within 7 days of delivery, as long as the item is unused, unwashed and has its original tags. See the <a href="/policies/return-policy">return policy</a> for details.</p>
`,
    faqs: [
      {
        question: "Which measurement matters most for a kurti?",
        answer:
          "Bust is usually the deciding measurement for a kurti. For co-ord sets with trousers, also check your hip measurement against the size guide.",
      },
      {
        question: "Should I size up for a relaxed fit?",
        answer:
          "If you are between two sizes and like a relaxed fit, choose the larger size. Measurements can vary by about 1 inch between garments.",
      },
    ],
  },
  {
    category: "fabric-care",
    slug: "how-to-wash-and-care-for-rayon-and-cotton-blend-kurtis",
    title: "How to Wash and Care for Rayon-Blend and Cotton-Blend Kurtis",
    seoTitle: "How to Wash Rayon & Cotton-Blend Kurtis (Care Guide)",
    seoDescription:
      "Simple washing, drying and ironing steps that keep printed rayon-blend and cotton-blend kurtis soft, bright and well shaped.",
    tags: ["care guide", "wash care", "rayon", "cotton blend"],
    productSlugs: ["premium-floral-sleeveless-kurti", "olive-blossom-co-ord-set"],
    content: `
<p><strong>Wash printed kurtis separately in cold water, never bleach them, dry them in shade and iron on a low to medium setting.</strong> These few habits keep colours bright and the fabric soft for longer.</p>

<h2>The care steps we recommend</h2>
<p>The care instructions on our product pages follow the same pattern. For example, the Premium Floral Sleeveless Kurti is machine washed separately in cold water, not bleached, dried in shade, ironed on low heat and not tumble dried. The Olive Blossom Co-ord Set is gently hand washed separately in cold water with mild detergent, not soaked for a long time, dried in shade and ironed on low to medium heat. Always check the care text on the product page for your exact style.</p>

<h2>Step by step</h2>
<ol>
<li><strong>Sort first.</strong> Wash dark and light colours separately, and wash printed pieces apart from heavy items like jeans or towels.</li>
<li><strong>Use cold water.</strong> Heat can fade prints and make lightweight fabrics shrink or lose their drape.</li>
<li><strong>Choose a mild detergent.</strong> Harsh detergents wear down colour faster.</li>
<li><strong>Skip bleach and long soaking.</strong> Both can weaken fabric and cause patchy colour.</li>
<li><strong>Dry in shade.</strong> Direct sun can fade prints, so hang the garment in a shaded, airy spot.</li>
<li><strong>Iron on low heat.</strong> Iron while slightly damp or use a low setting, ideally from the reverse side of the print.</li>
</ol>

<h2>Why does rayon need extra care?</h2>
<p>Rayon is a soft, smooth fabric made from plant-based fibres, and it can be more delicate when wet. A gentle cycle or hand wash and shade drying help it keep its shape. Blends with cotton are usually easier to look after, but the same cold-water, low-heat routine is the safe choice.</p>

<h2>How do I avoid fading?</h2>
<p>Turn the kurti inside out before washing, use cold water, avoid bleach and dry it away from direct sunlight.</p>

<h2>Looking for something to wear?</h2>
<p>See the full range in <a href="/shop">the shop</a>, or read our <a href="/pages/size-guide">size guide</a> before you order.</p>
`,
    faqs: [
      {
        question: "Can I tumble dry my kurti?",
        answer:
          "No. The care instructions on our kurti product pages say not to tumble dry. Dry the garment in shade instead.",
      },
      {
        question: "Can I use bleach on a printed kurti?",
        answer:
          "No. Do not bleach printed kurtis, because bleach can fade or damage the print and weaken the fabric.",
      },
    ],
  },
  {
    category: "styling",
    slug: "how-to-style-a-floral-kurti-for-office-and-everyday",
    title: "How to Style a Floral Kurti for Office and Everyday Wear",
    seoTitle: "How to Style a Floral Kurti for Office & Everyday",
    seoDescription:
      "Easy ways to wear a floral kurti or co-ord set to work and beyond, with simple pairing, footwear and accessory ideas.",
    tags: ["styling", "floral kurti", "office wear", "co-ord set"],
    productSlugs: [
      "olive-blossom-co-ord-set",
      "premium-floral-sleeveless-kurti",
      "premium-pink-floral-sleeveless-kurti",
    ],
    content: `
<p><strong>A floral kurti works for the office when you keep the rest of the outfit simple: straight trousers or a matching bottom, minimal jewellery and flat or low-heeled shoes.</strong> Let the print be the one statement.</p>

<h2>Start with the right silhouette</h2>
<p>For work, a straight-fit kurti with a minimal neckline looks neat and stays comfortable through a long day. A co-ord set removes the guesswork, because the top and trousers are already matched. The <a href="/shop/olive-blossom-co-ord-set">Olive Blossom Co-ord Set</a>, for example, pairs a straight-fit kurti with a V-neckline and three-quarter sleeves with matching wide-leg trousers, in an ivory base with olive-green floral print.</p>

<h2>What should I pair with a sleeveless kurti?</h2>
<p>Sleeveless kurtis such as the <a href="/shop/premium-pink-floral-sleeveless-kurti">Premium Pink Floral Sleeveless Kurti</a> and the <a href="/shop/premium-floral-sleeveless-kurti">Premium Floral Sleeveless Kurti</a> pair easily with palazzos, straight trousers or jeans. For a more formal setting, add a light shrug or a plain dupatta in a shade picked from the print.</p>

<h2>Colour and print tips</h2>
<ul>
<li>Pick one colour from the print and repeat it in your bag or dupatta.</li>
<li>Keep the bottom plain when the kurti is heavily printed.</li>
<li>Use neutral footwear such as tan, nude or black flats.</li>
</ul>

<h2>From desk to dinner</h2>
<p>Swap flats for block heels, add a pair of earrings and carry a structured bag. The same kurti then works for brunch or an evening out. Browse more everyday options in <a href="/categories/everyday-wear">Everyday Wear</a> and workday looks in <a href="/categories/office-wear">Office Wear</a>.</p>

<h2>Take care of the print</h2>
<p>Printed kurtis last longer with cold washing and shade drying. See our <a href="/blog/how-to-wash-and-care-for-rayon-and-cotton-blend-kurtis">care guide</a> for the steps.</p>
`,
    faqs: [
      {
        question: "Is a floral kurti suitable for office wear?",
        answer:
          "Yes, when you keep the styling simple. Choose a straight fit or a matched co-ord set, plain bottoms and minimal accessories.",
      },
      {
        question: "What goes well with a sleeveless kurti?",
        answer:
          "Palazzos, straight trousers and jeans all work. For a formal look, add a light shrug or a plain dupatta.",
      },
    ],
  },
  {
    category: "shopping-guides",
    slug: "pre-orders-explained-how-made-after-order-pieces-work",
    title: "Pre-Orders Explained: How Made-After-Order Pieces Work",
    seoTitle: "Pre-Orders Explained: How Made-After-Order Works",
    seoDescription:
      "What a pre-order is at The Vastra House, how dispatch dates work, how to follow production, and how pre-orders differ from in-stock orders.",
    tags: ["pre-order", "shipping", "how it works"],
    productSlugs: [],
    content: `
<p><strong>A pre-order is an item that is made after you order it, so it ships on the expected dispatch date shown on the product page instead of within the usual in-stock dispatch window.</strong> Here is how that works at The Vastra House.</p>

<h2>How is a pre-order different from an in-stock order?</h2>
<p>In-stock orders are dispatched within 2–4 business days. Pre-order items are produced after you order, and they ship on the expected dispatch date shown on the product page. You can browse current pre-orders on the <a href="/pre-order">pre-order page</a>.</p>

<h2>Are the dates exact?</h2>
<p>No. Expected dispatch dates are estimates, because making a piece to order depends on production. We keep you updated at each production stage so you know where your order is.</p>

<h2>How do I follow my order?</h2>
<p>Use the <a href="/track-order">Track Order</a> page with your order number, or open My Account and go to Orders. Once your order ships you also receive tracking details by email.</p>

<h2>Can I cancel a pre-order?</h2>
<p>You can cancel from My Account &gt; Orders until the order is dispatched. After dispatch an order cannot be cancelled, but you can request a return after delivery. Read the <a href="/policies/cancellation-policy">cancellation policy</a> for the full wording.</p>

<h2>What about returns?</h2>
<p>You can request a return within 7 days of delivery if the item is unused, unwashed and has its original tags. Custom and made-to-measure pieces cannot be returned unless they arrive damaged or defective. See the <a href="/policies/return-policy">return policy</a>.</p>

<h2>Before you order</h2>
<p>Check your size with the <a href="/pages/size-guide">size guide</a>, because a made-after-order piece is easier to get right the first time. More answers are in our <a href="/faq">FAQs</a>.</p>
`,
    faqs: [
      {
        question: "How long does a pre-order take to ship?",
        answer:
          "Each pre-order item shows an expected dispatch date on its product page. The date is an estimate, and we update you at each production stage.",
      },
      {
        question: "Can I track a pre-order?",
        answer:
          "Yes. Use the Track Order page or My Account > Orders, and watch your email for tracking details once it ships.",
      },
    ],
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  let author = await BlogAuthor.findOne({ slug: AUTHOR.slug });
  if (author) {
    log(`Author exists: ${AUTHOR.name}`);
  } else {
    log(`Create author: ${AUTHOR.name}`);
    if (APPLY) author = await BlogAuthor.create(AUTHOR);
  }

  const categoryIds = new Map<string, unknown>();
  for (const category of CATEGORIES) {
    let doc = await BlogCategory.findOne({ slug: category.slug });
    if (doc) {
      log(`Category exists: ${category.name}`);
    } else {
      log(`Create category: ${category.name}`);
      if (APPLY) doc = await BlogCategory.create(category);
    }
    if (doc) categoryIds.set(category.slug, doc._id);
  }

  const products = (await Product.find({ slug: { $in: ARTICLES.flatMap((a) => a.productSlugs) } })
    .select("slug media")
    .lean()) as unknown as Array<{
    _id: unknown;
    slug: string;
    media?: Array<Record<string, unknown>>;
  }>;
  const productBySlug = new Map(products.map((product) => [product.slug, product]));

  let created = 0;
  let skipped = 0;

  for (const article of ARTICLES) {
    if (await BlogPost.exists({ slug: article.slug })) {
      skipped += 1;
      log(`Skipped (exists): /blog/${article.slug}`);
      continue;
    }

    const content = sanitizeRichHtml(article.content.trim());
    const related = article.productSlugs
      .map((slug) => productBySlug.get(slug))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    created += 1;
    log(
      `Create article /blog/${article.slug} (${estimateReadingMinutes(content)} min, ${htmlToPlainText(content).split(" ").length} words, ${related.length} related products)`,
    );

    if (APPLY) {
      await BlogPost.create({
        authorId: author?._id,
        categoryId: categoryIds.get(article.category),
        content,
        excerpt: htmlToPlainText(content).slice(0, 220),
        faqs: article.faqs,
        postStatus: "published",
        publishedAt: new Date(),
        readingMinutes: estimateReadingMinutes(content),
        relatedProductIds: related.map((product) => product._id),
        seo: {
          description: article.seoDescription,
          robotsFollow: true,
          robotsIndex: true,
          schemaEnabled: true,
          title: article.seoTitle,
        },
        slug: article.slug,
        tags: article.tags,
        title: article.title,
      });
    }
  }

  log(`Summary: ${created} article(s) ${APPLY ? "created" : "to create"}, ${skipped} skipped`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
