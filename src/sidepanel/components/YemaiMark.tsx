interface YemaiMarkProps {
  className?: string;
}

export function YemaiMark({ className = '' }: YemaiMarkProps) {
  return (
    <img
      className={`yemai-mark${className ? ` ${className}` : ''}`}
      src="/icon.svg"
      width="64"
      height="64"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}
