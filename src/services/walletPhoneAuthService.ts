import { backendCapabilities } from '@/services/testagramCapabilityClient';
export type WalletPhoneIdentity = { id:string; user_id:string; wallet_id:string; phone_e164:string; verified_at:string; auth_provider:string; provider_subject:string|null; created_at:string; updated_at:string };
export function normalizeKenyaPhone(input:string):string {
 const compact=input.trim().replace(/[\\s().-]/g,'');
 if(/^07\\d{8}$/.test(compact)||/^01\\d{8}$/.test(compact))return `+254${compact.slice(1)}`;
 if(/^254\\d{9}$/.test(compact))return `+${compact}`;
 if(/^\\+254\\d{9}$/.test(compact))return compact;
 throw new Error('Enter a valid Kenyan mobile number, e.g. 0712345678.');
}
export async function requestWalletPhoneOtp(phoneInput:string){const phone=normalizeKenyaPhone(phoneInput);return backendCapabilities.call('testagram.wallet.phone.otp.request',{phone});}
export async function verifyWalletPhoneOtp(phoneInput:string,token:string){const phone=normalizeKenyaPhone(phoneInput);const cleanToken=token.replace(/\\D/g,'');if(cleanToken.length<6)throw new Error('Enter the 6-digit OTP.');return backendCapabilities.call<{phone:string;user_id:string}>('testagram.wallet.phone.otp.verify',{phone,otp:cleanToken});}
export async function linkVerifiedPhoneToWallet(walletId:string,phoneInput:string){return backendCapabilities.call<WalletPhoneIdentity>('testagram.wallet.phone.link',{wallet_id:walletId,phone_e164:normalizeKenyaPhone(phoneInput)});}
export async function getWalletPhoneIdentity(walletId:string){return backendCapabilities.call<WalletPhoneIdentity|null>('testagram.wallet.phone.read',{wallet_id:walletId});}
export const walletPhoneAuthService={normalizeKenyaPhone,requestWalletPhoneOtp,verifyWalletPhoneOtp,linkVerifiedPhoneToWallet,getWalletPhoneIdentity};
