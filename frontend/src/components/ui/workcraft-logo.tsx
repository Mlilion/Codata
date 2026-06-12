interface WorkCraftLogoProps {
  size?: number;
  className?: string;
}

export function WorkCraftLogo({ size = 20, className }: WorkCraftLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-512.png"
      width={size}
      height={size}
      alt="WorkCraft"
      className={className}
      style={{ width: size, height: size }}
    />
  );
}