import { Schema, type Types } from "mongoose";

export const aspectRatios = [
  "1:1",
  "4:5",
  "9:16",
  "16:7",
  "16:9",
  "21:9",
  "3:2",
  "2:3",
  "custom",
] as const;

export type AspectRatio = (typeof aspectRatios)[number];

export type MediaReference = {
  mediaId?: Types.ObjectId;
  url: string;
  altText?: string;
  type: "image" | "video" | "pdf" | "lookbook";
  aspectRatio?: AspectRatio;
  objectFit?: "cover" | "contain";
};

export const mediaReferenceSchema = new Schema<MediaReference>(
  {
    mediaId: { type: Schema.Types.ObjectId, ref: "Media" },
    url: { type: String, required: true, trim: true },
    altText: { type: String, required: true, trim: true },
    type: { type: String, enum: ["image", "video", "pdf", "lookbook"], required: true },
    aspectRatio: { type: String, enum: aspectRatios, required: true },
    objectFit: { type: String, enum: ["cover", "contain"], default: "cover" },
  },
  { _id: false },
);
