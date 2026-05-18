"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ConfirmOpts = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export function useConfirm() {
  const [opts, setOpts] = React.useState<ConfirmOpts | null>(null);
  const resolverRef = React.useRef<((ok: boolean) => void) | null>(null);

  const confirm = React.useCallback((o: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  const close = (ok: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    resolver?.(ok);
  };

  const dialog = (
    <Dialog
      open={opts !== null}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      {opts && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{opts.title}</DialogTitle>
            {opts.description && (
              <DialogDescription>{opts.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {opts.cancelText ?? "Болих"}
            </Button>
            <Button
              variant={opts.danger ? "destructive" : "default"}
              onClick={() => close(true)}
            >
              {opts.confirmText ?? "Тийм"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

  return { confirm, dialog };
}
