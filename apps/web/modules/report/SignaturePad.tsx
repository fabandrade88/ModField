"use client";
import { useEffect, useRef } from "react";
import SignaturePadLib from "signature_pad";
import { Button, Dialog } from "@/components/controls";
import { useT } from "@/components/i18n";

/** Signature drawn with mouse, pen or finger; saved as a PNG picture. */
export function SignatureDialog({ open, title, onClose, onSave }: { open: boolean; title: string; onClose: () => void; onSave: (png: string) => void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePadLib>(undefined);

  useEffect(() => {
    if (!open) return;
    // Wait one frame: the canvas lives in the dialog that showModal() just opened.
    const id = requestAnimationFrame(() => {
      const c = canvas.current;
      if (!c) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      c.width = c.offsetWidth * ratio;
      c.height = c.offsetHeight * ratio;
      c.getContext("2d")!.scale(ratio, ratio);
      pad.current = new SignaturePadLib(c, { penColor: "#111111", backgroundColor: "rgba(255,255,255,0)" });
    });
    return () => {
      cancelAnimationFrame(id);
      pad.current?.off();
      pad.current = undefined;
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className="max-w-xl"
      footer={
        <>
          <Button onClick={() => pad.current?.clear()}>{t("report.sign.clear")}</Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              if (pad.current && !pad.current.isEmpty()) onSave(pad.current.toDataURL("image/png"));
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-muted">{t("report.sign.help")}</p>
      {/* White pad: the signature prints on paper. */}
      <canvas ref={canvas} aria-label={t("report.sign.canvas")} className="h-48 w-full touch-none border border-border bg-white" />
    </Dialog>
  );
}
