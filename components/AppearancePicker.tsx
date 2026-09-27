"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { colorStyles } from "@/lib/color-styles";

export function AppearancePicker() {
  const headingId = useId();
  const [selected, setSelected] = useState("classic");
  const [saved, setSaved] = useState(true);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open)
          setSelected(document.documentElement.dataset.colorStyle ?? "classic");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline">
          <span
            aria-hidden="true"
            className="size-3 rounded-full border border-foreground/40 bg-primary"
          />
          Appearance
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={headingId}
        className="w-80 max-w-[calc(100vw-2rem)] rounded-lg motion-reduce:animate-none"
      >
        <div className="space-y-1">
          <h2 id={headingId} className="font-semibold">
            Color style
          </h2>
          <p className="text-xs text-muted-foreground">
            Make Contextus feel like you.
          </p>
        </div>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Color style</legend>
          {colorStyles.map((style) => (
            <label
              key={style.id}
              className="relative cursor-pointer rounded-md border border-border p-2 has-checked:border-foreground has-checked:bg-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground"
            >
              <input
                type="radio"
                name={headingId}
                value={style.id}
                checked={selected === style.id}
                className="sr-only"
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
                className="mb-2 flex h-12 gap-1.5 overflow-hidden rounded-sm border border-white/15 p-2"
                style={{ background: style.colors[0] }}
              >
                <span
                  className="w-3 rounded-sm"
                  style={{ background: style.colors[1] }}
                />
                <span className="flex flex-1 flex-col justify-between gap-1">
                  <span className="h-1 w-3/4 rounded-sm bg-white/60" />
                  <span className="h-1 w-1/2 rounded-sm bg-white/25" />
                  <span
                    className="h-3 rounded-sm"
                    style={{ background: style.colors[2] }}
                  />
                </span>
              </span>
              <span className="flex items-center justify-between text-xs font-medium">
                {style.name}
                <span aria-hidden="true">
                  {selected === style.id ? "✓" : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {!saved && (
          <p role="status" className="text-xs text-muted-foreground">
            Applied for now. Your browser couldn’t save this choice.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
