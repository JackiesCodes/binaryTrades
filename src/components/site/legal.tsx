export const LEGAL_UPDATED = "1 November 2026";

export function Contact() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return email ? (
    <a href={`mailto:${email}`} className="text-profit underline">
      {email}
    </a>
  ) : (
    <span>the support address shown in the site footer</span>
  );
}
