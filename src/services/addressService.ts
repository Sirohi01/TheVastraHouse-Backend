import type { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { User } from "../models/User.js";
import type { Address, AddressBookEntry } from "../models/shared/address.js";

const MAX_ADDRESSES = 20;

type AddressInput = AddressBookEntry;
type StoredAddress = AddressBookEntry & { _id: Types.ObjectId };

export async function listAddresses(userId: string) {
  const user = (await User.findById(userId).select("addresses").lean()) as {
    addresses?: StoredAddress[];
  } | null;

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user.addresses ?? [];
}

export async function addAddress(userId: string, input: AddressInput) {
  const user = await User.findById(userId).select("addresses");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const addresses = user.addresses as unknown as StoredAddress[] & {
    push: (value: unknown) => void;
  };

  if (addresses.length >= MAX_ADDRESSES) {
    throw new AppError(`You can save up to ${MAX_ADDRESSES} addresses`, 400);
  }

  const isFirst = addresses.length === 0;
  const entry = {
    ...normalizeAddress(input),
    isDefaultBilling: isFirst || Boolean(input.isDefaultBilling),
    isDefaultShipping: isFirst || Boolean(input.isDefaultShipping),
  };

  if (entry.isDefaultShipping) addresses.forEach((item) => (item.isDefaultShipping = false));
  if (entry.isDefaultBilling) addresses.forEach((item) => (item.isDefaultBilling = false));
  addresses.push(entry);
  await user.save();
  return listAddresses(userId);
}

export async function updateAddress(userId: string, addressId: string, input: AddressInput) {
  const user = await User.findById(userId).select("addresses");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const addresses = user.addresses as unknown as StoredAddress[];
  const target = addresses.find((item) => String(item._id) === addressId);

  if (!target) {
    throw new AppError("Address not found", 404);
  }

  Object.assign(target, normalizeAddress(input));

  if (input.isDefaultShipping) {
    addresses.forEach((item) => (item.isDefaultShipping = String(item._id) === addressId));
  }

  if (input.isDefaultBilling) {
    addresses.forEach((item) => (item.isDefaultBilling = String(item._id) === addressId));
  }

  await user.save();
  return listAddresses(userId);
}

export async function deleteAddress(userId: string, addressId: string) {
  const user = await User.findById(userId).select("addresses");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const addresses = user.addresses as unknown as StoredAddress[] & {
    pull: (id: string) => void;
  };
  const target = addresses.find((item) => String(item._id) === addressId);

  if (!target) {
    throw new AppError("Address not found", 404);
  }

  const wasDefaultShipping = target.isDefaultShipping;
  const wasDefaultBilling = target.isDefaultBilling;
  addresses.pull(addressId);
  const remaining = user.addresses as unknown as StoredAddress[];

  // Keep a default in place when the default address is removed.
  if (remaining.length && wasDefaultShipping) remaining[0].isDefaultShipping = true;
  if (remaining.length && wasDefaultBilling) remaining[0].isDefaultBilling = true;
  await user.save();
  return listAddresses(userId);
}

/** Saves a checkout address unless an identical one already exists. */
export async function saveCheckoutAddress(userId: string, address: Address) {
  const existing = await listAddresses(userId);
  const fingerprint = addressFingerprint(address);

  if (existing.some((item) => addressFingerprint(item) === fingerprint)) {
    return existing;
  }

  if (existing.length >= MAX_ADDRESSES) {
    return existing;
  }

  return addAddress(userId, { ...address, label: "Checkout" });
}

function normalizeAddress(input: AddressInput) {
  const postalCode = input.postalCode?.replace(/\s+/g, "");

  if (input.countryCode.toUpperCase() === "IN" && postalCode && !/^[1-9]\d{5}$/.test(postalCode)) {
    throw new AppError("Enter a valid 6-digit Indian PIN code", 400);
  }

  if (input.phone && !/^\+?[0-9\s-]{8,16}$/.test(input.phone)) {
    throw new AppError("Enter a valid phone number", 400);
  }

  return {
    city: input.city.trim(),
    company: input.company?.trim() || undefined,
    countryCode: input.countryCode.trim().toUpperCase(),
    fullName: input.fullName?.trim() || undefined,
    label: input.label?.trim() || undefined,
    line1: input.line1.trim(),
    line2: input.line2?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    postalCode: postalCode || undefined,
    region: input.region?.trim() || undefined,
  };
}

function addressFingerprint(address: Address) {
  return [address.line1, address.line2, address.city, address.postalCode, address.countryCode]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
}
