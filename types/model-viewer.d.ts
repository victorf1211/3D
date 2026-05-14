import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          "camera-controls"?: boolean;
          "shadow-intensity"?: string;
          "environment-image"?: string;
          exposure?: string;
        },
        HTMLElement
      >;
    }
  }
}
