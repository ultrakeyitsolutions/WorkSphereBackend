import { z } from 'zod';
import {
    mfaSetupVerifySchema,
    mfaVerifySchema,
    mfaRecoverySchema,
    mfaDisableSchema,
} from './mfa.schema';

export type MfaSetupVerifyDto = z.infer<typeof mfaSetupVerifySchema>;
export type MfaVerifyDto = z.infer<typeof mfaVerifySchema>;
export type MfaRecoveryDto = z.infer<typeof mfaRecoverySchema>;
export type MfaDisableDto = z.infer<typeof mfaDisableSchema>;

export interface MfaSetupResponse {
    qrCodeDataUrl: string;
    otpauthUrl: string;
    secret: string; // for manual entry on Authenticator apps
}

export interface MfaStatusResponse {
    mfaEnabled: boolean;
    enabledAt?: Date | null;
    method?: string;
    hasRecoveryCodes?: boolean;
}
