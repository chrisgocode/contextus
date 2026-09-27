export const colorStyles = [
  {
    id: "classic",
    name: "Classic",
    colors: ["#18181b", "#27272a", "#991b1b"],
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: ["#111827", "#1e293b", "#2563eb"],
  },
  {
    id: "forest",
    name: "Forest",
    colors: ["#10251e", "#1b352b", "#047857"],
  },
  {
    id: "plum",
    name: "Plum",
    colors: ["#241829", "#35233c", "#7e22ce"],
  },
  {
    id: "espresso",
    name: "Espresso",
    colors: ["#251c16", "#38291f", "#92400e"],
  },
  {
    id: "slate",
    name: "Slate",
    colors: ["#1e222b", "#2c3340", "#be185d"],
  },
] as const;

export const colorStyleScript = `try {
  const value = localStorage.getItem("contextus:color-style");
  if (${JSON.stringify(colorStyles.map(({ id }) => id))}.includes(value)) {
    document.documentElement.dataset.colorStyle = value;
  }
} catch {}`;
