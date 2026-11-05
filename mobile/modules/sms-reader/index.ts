// Finlyt's SMS reader (Android only). Optional so builds without it keep working.
import { requireOptionalNativeModule } from "expo";

export type InboxMessage = { id: string; sender: string; body: string; date: number };

type SmsReaderModule = {
  hasPermission(): boolean;
  readInbox(sinceMillis: number, limit: number): Promise<InboxMessage[]>;
};

export const SmsReader = requireOptionalNativeModule<SmsReaderModule>("SmsReader");
