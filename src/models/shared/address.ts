import { Schema } from "mongoose";

export type Address = {
  fullName?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  phone?: string;
};

export const addressSchema = new Schema<Address>(
  {
    fullName: { type: String, trim: true },
    company: { type: String, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    region: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
      trim: true,
    },
    phone: { type: String, trim: true },
  },
  { _id: false },
);

export type AddressBookEntry = Address & {
  label?: string;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
};

export const addressBookEntrySchema = new Schema<AddressBookEntry>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    fullName: { type: String, trim: true },
    company: { type: String, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    region: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    countryCode: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2, trim: true },
    phone: { type: String, trim: true },
    isDefaultShipping: { type: Boolean, default: false },
    isDefaultBilling: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);
