import mongoose, { Schema } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { contentFaqSchema, seoFieldsSchema } from "./shared/seo.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const blogCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    seo: seoFieldsSchema,
  },
  { timestamps: true },
);
applySoftDeleteFields(blogCategorySchema);
blogCategorySchema.index({ slug: 1 }, { unique: true });

const blogAuthorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    bio: { type: String, trim: true },
    avatar: mediaReferenceSchema,
    userId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
applySoftDeleteFields(blogAuthorSchema);
blogAuthorSchema.index({ slug: 1 }, { unique: true });

const blogPostSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    excerpt: { type: String, trim: true, maxlength: 500 },
    // Sanitised HTML produced by the admin rich-text editor (see services/htmlSanitizer.ts).
    content: { type: String, required: true },
    featuredImage: mediaReferenceSchema,
    categoryId: { type: Schema.Types.ObjectId, ref: "BlogCategory", index: true },
    tags: [{ type: String, trim: true, lowercase: true }],
    authorId: { type: Schema.Types.ObjectId, ref: "BlogAuthor" },
    relatedProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    faqs: [contentFaqSchema],
    postStatus: {
      type: String,
      enum: ["draft", "scheduled", "published"],
      default: "draft",
      index: true,
    },
    publishedAt: { type: Date, index: true },
    readingMinutes: { type: Number, min: 1 },
    seo: seoFieldsSchema,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
applySoftDeleteFields(blogPostSchema);
blogPostSchema.index({ slug: 1 }, { unique: true });
blogPostSchema.index({ postStatus: 1, publishedAt: -1 });
blogPostSchema.index({ tags: 1, postStatus: 1 });

export const BlogCategory =
  mongoose.models.BlogCategory || mongoose.model("BlogCategory", blogCategorySchema);
export const BlogAuthor =
  mongoose.models.BlogAuthor || mongoose.model("BlogAuthor", blogAuthorSchema);
export const BlogPost = mongoose.models.BlogPost || mongoose.model("BlogPost", blogPostSchema);
