export function Divider({ orientation = "vertical" }: { orientation?: "horizontal" | "vertical" }) {
  return <span className={`ui-divider ui-divider-${orientation}`} aria-hidden="true" />;
}
