"use client";

import { WhatsappLogo } from "phosphor-react";

interface SupportWhatsAppLinkProps {
  /** Digits-only WhatsApp number of the platform owner (SUPPORT_WHATSAPP). */
  phone: string;
  /** Prefilled message; the caller translates it. */
  message: string;
  /** Visible button text. */
  label: string;
}

/**
 * Full-width WhatsApp button to the CareLog admin (login revamp D5). There is
 * no email or SMS budget, so "contact the admin on WhatsApp" is how owners
 * recover a password or chase an approval. A client component only because
 * the icon library needs React context.
 */
export function SupportWhatsAppLink({ phone, message, label }: SupportWhatsAppLinkProps) {
  return (
    <a
      href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-base touch-target flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-whatsapp)] font-semibold text-[var(--color-whatsapp-ink)] hover:bg-[var(--color-whatsapp-hover)]"
    >
      <WhatsappLogo size={22} weight="fill" aria-hidden="true" />
      {label}
    </a>
  );
}
