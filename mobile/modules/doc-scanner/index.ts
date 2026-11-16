// Google's document scanner for receipts (Android, run by Play services). Optional, so a build
// without the module says scanning needs the latest app instead of crashing.
import { requireOptionalNativeModule } from "expo";

type DocScannerModule = {
  /** Opens the scanner. Resolves with each page as a JPEG file URI, or null if it was closed. */
  scan(pageLimit: number): Promise<{ pages: string[] } | null>;
};

export const DocScanner = requireOptionalNativeModule<DocScannerModule>("DocScanner");
