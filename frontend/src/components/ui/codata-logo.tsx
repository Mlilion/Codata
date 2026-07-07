interface CodataLogoProps {
  size?: number;
  className?: string;
}

export function CodataLogo({ size = 20, className }: CodataLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-512.png"
      width={size}
      height={size}
      alt="Codata"
      className={className}
      style={{ width: size, height: size }}
    />
  );
}