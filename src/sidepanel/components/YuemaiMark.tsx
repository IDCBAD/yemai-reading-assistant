interface YuemaiMarkProps {
  className?: string;
}

export function YuemaiMark({ className = '' }: YuemaiMarkProps) {
  return (
    <img
      className={`yuemai-mark${className ? ` ${className}` : ''}`}
      src="/icon.svg"
      width="64"
      height="64"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}
