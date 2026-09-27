"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { colorStyles } from "@/lib/color-styles";

// Background on one half, primary on the other. The outline is an opaque inset
// ring painted over the fill: a translucent border lets the primary half show
// through and poke past the circle's edge.
const swatchClassName =
  "block rounded-full inset-ring inset-ring-[color-mix(in_oklab,var(--foreground)_28%,var(--popover))]";

function splitFill(background: string, primary: string) {
  return `linear-gradient(135deg, ${background} 50%, ${primary} 50%)`;
}

export function AppearancePicker() {
  const headingId = useId();
  const [selected, setSelected] = useState("classic");
  const [saved, setSaved] = useState(true);
  const selectedName =
    colorStyles.find((style) => style.id === selected)?.name ?? "Classic";

  return (
    <Popover
      onOpenChange={(open) => {
        if (open)
          setSelected(document.documentElement.dataset.colorStyle ?? "classic");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Appearance"
          title="Appearance"
        >
          {/* CSS variables track the active style without waiting for hydration. */}
          <span
            aria-hidden="true"
            className={`${swatchClassName} size-4`}
            style={{
              background: splitFill("var(--background)", "var(--primary)"),
            }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={headingId}
        className="w-auto max-w-[calc(100vw-2rem)] gap-2 p-3 motion-reduce:animate-none"
      >
        <h2 id={headingId} className="sr-only">
          Color style
        </h2>
        <fieldset className="flex gap-2.5">
          <legend className="sr-only">Color style</legend>
          {colorStyles.map((style) => (
            <label
              key={style.id}
              title={style.name}
              className="cursor-pointer rounded-full has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-foreground"
            >
              <input
                type="radio"
                name={headingId}
                value={style.id}
                aria-label={style.name}
                checked={selected === style.id}
                className="peer sr-only"
                onChange={() => {
                  document.documentElement.dataset.colorStyle = style.id;
                  setSelected(style.id);
                  try {
                    localStorage.setItem("contextus:color-style", style.id);
                    setSaved(true);
                  } catch {
                    setSaved(false);
                  }
                }}
              />
              <span
                aria-hidden="true"
                className={`${swatchClassName} size-7 peer-checked:ring-2 peer-checked:ring-foreground peer-checked:ring-offset-2 peer-checked:ring-offset-popover`}
                style={{
                  background: splitFill(style.colors[0], style.colors[2]),
                }}
              />
            </label>
          ))}
        </fieldset>
        <p
          aria-hidden="true"
          className="text-center text-xs text-muted-foreground"
        >
          {selectedName}
        </p>
        {!saved && (
          <p role="status" className="max-w-56 text-xs text-muted-foreground">
            Applied for now. Your browser couldn’t save this choice.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
