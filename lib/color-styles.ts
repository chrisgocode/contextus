export const colorStyles = [
  {
    id: "classic",
    name: "Classic",
    colors: ["#18181b", "#27272a", "#991b1b"],
    description: "Black & red · Default",
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: ["#111827", "#1e293b", "#2563eb"],
    description: "Navy & blue",
  },
  {
    id: "forest",
    name: "Forest",
    colors: ["#10251e", "#1b352b", "#047857"],
    description: "Pine & mint",
  },
  {
    id: "plum",
    name: "Plum",
    colors: ["#241829", "#35233c", "#7e22ce"],
    description: "Plum & lilac",
  },
  {
    id: "espresso",
    name: "Espresso",
    colors: ["#251c16", "#38291f", "#92400e"],
    description: "Cocoa & amber",
  },
  {
    id: "slate",
    name: "Slate",
    colors: ["#1e222b", "#2c3340", "#be185d"],
    description: "Slate & rose",
  },
] as const;

export const colorStyleScript = `try {
  const value = localStorage.getItem("contextus:color-style");
  if (${JSON.stringify(colorStyles.map(({ id }) => id))}.includes(value)) {
    document.documentElement.dataset.colorStyle = value;
  }
} catch {}`;
