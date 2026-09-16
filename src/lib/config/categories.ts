import type { PackageSlug } from "./packages";

export type Category = {
  slug: string;
  label: string;
  /** Text sent to Places Text Search, e.g. "nail salon in 77084" */
  query: string;
  packageSlug: PackageSlug;
};

export const CATEGORIES: Category[] = [
  { slug: "restaurant", label: "Restaurant", query: "restaurant", packageSlug: "internet_tv_voice" },
  { slug: "cafe", label: "Cafe / Coffee shop", query: "coffee shop", packageSlug: "internet_tv_voice" },
  { slug: "bar", label: "Bar", query: "bar", packageSlug: "internet_tv_voice" },
  { slug: "bakery", label: "Bakery", query: "bakery", packageSlug: "internet_tv_voice" },
  { slug: "nail_salon", label: "Nail salon", query: "nail salon", packageSlug: "internet_mobile" },
  { slug: "hair_salon", label: "Hair salon", query: "hair salon", packageSlug: "internet_mobile" },
  { slug: "barber", label: "Barber shop", query: "barber shop", packageSlug: "internet_mobile" },
  { slug: "spa", label: "Spa", query: "day spa", packageSlug: "internet_mobile" },
  { slug: "boutique", label: "Boutique / Clothing", query: "boutique clothing store", packageSlug: "internet_mobile" },
  { slug: "gift_shop", label: "Gift shop", query: "gift shop", packageSlug: "internet_mobile" },
  { slug: "florist", label: "Florist", query: "florist", packageSlug: "internet_mobile" },
  { slug: "dentist", label: "Dentist", query: "dentist", packageSlug: "internet_voice_multiline" },
  { slug: "medical_clinic", label: "Medical clinic", query: "medical clinic", packageSlug: "internet_voice_multiline" },
  { slug: "chiropractor", label: "Chiropractor", query: "chiropractor", packageSlug: "internet_voice_multiline" },
  { slug: "optometrist", label: "Optometrist", query: "optometrist", packageSlug: "internet_voice_multiline" },
  { slug: "veterinarian", label: "Veterinarian", query: "veterinarian", packageSlug: "internet_voice_multiline" },
  { slug: "pet_grooming", label: "Pet grooming", query: "pet grooming", packageSlug: "internet_mobile" },
  { slug: "daycare", label: "Daycare", query: "daycare", packageSlug: "internet_voice" },
  { slug: "tutoring", label: "Tutoring center", query: "tutoring center", packageSlug: "internet_voice" },
  { slug: "gym", label: "Gym / Fitness studio", query: "gym", packageSlug: "internet_mobile" },
  { slug: "yoga", label: "Yoga / Pilates studio", query: "yoga studio", packageSlug: "internet_mobile" },
  { slug: "auto_repair", label: "Auto repair", query: "auto repair shop", packageSlug: "internet_mobile" },
  { slug: "tire_shop", label: "Tire shop", query: "tire shop", packageSlug: "internet_mobile" },
  { slug: "car_wash", label: "Car wash", query: "car wash", packageSlug: "internet_mobile" },
  { slug: "dry_cleaner", label: "Dry cleaner", query: "dry cleaner", packageSlug: "internet_mobile" },
  { slug: "laundromat", label: "Laundromat", query: "laundromat", packageSlug: "internet_mobile" },
  { slug: "insurance", label: "Insurance agency", query: "insurance agency", packageSlug: "internet_voice_multiline" },
  { slug: "real_estate", label: "Real estate office", query: "real estate office", packageSlug: "internet_voice_multiline" },
  { slug: "law_office", label: "Law office", query: "law office", packageSlug: "internet_voice_multiline" },
  { slug: "accounting", label: "Accounting / CPA", query: "accountant", packageSlug: "internet_voice_multiline" },
  { slug: "tattoo", label: "Tattoo studio", query: "tattoo studio", packageSlug: "internet_mobile" },
  { slug: "phone_repair", label: "Phone repair", query: "phone repair", packageSlug: "internet_mobile" },
  { slug: "print_shop", label: "Print shop", query: "print shop", packageSlug: "internet_voice" },
  { slug: "pharmacy", label: "Independent pharmacy", query: "independent pharmacy", packageSlug: "internet_voice_multiline" },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: string | null | undefined): string {
  return (slug && CATEGORY_BY_SLUG.get(slug)?.label) || slug || "";
}
