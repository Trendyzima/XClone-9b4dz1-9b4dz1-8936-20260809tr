import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { walletPhoneAuthService, type WalletPhoneIdentity } from '@/services/walletPhoneAuthService';
export interface Wallet { id:string; user_id:string; balance:number; total_deposited:number; total_withdrawn:number; mpesa_phone:string|null; paypal_email:string|null; created_at:string; updated_at:string; preferred_currency?:string|null; savings_balance?:number; spend_limit_enabled?:boolean; daily_spend_limit?:number|null; currency?:string|null; status?:string; spending_enabled?:boolean; withdrawals_enabled?:boolean }
export function useWallet(){
 const {user}=useAuth();
 const [wallet,setWallet]=useState<Wallet|null>(null);
 const [phoneIdentity,setPhoneIdentity]=useState<WalletPhoneIdentity|null>(null);
 const [walletSecurity,setWalletSecurity]=useState<{pin_set:boolean;biometric_credential_id:string|null;biometric_enabled:boolean}|null>(null);
 const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);
 const fetchWallet=useCallback(async()=>{
  if(!user){setWallet(null);setPhoneIdentity(null);setWalletSecurity(null);setLoading(false);return;}
  setLoading(true);setError(null);
  try{
   const result=await backendCapabilities.getWallet(1);
   const raw=(result as any).wallet as Wallet|null;
   if(!raw)throw new Error('Wallet is not provisioned for this account.');
   const [security,identity]=await Promise.all([
    backendCapabilities.call<any>('testagram.wallet.security.read'),
    walletPhoneAuthService.getWalletPhoneIdentity(raw.id).catch(()=>null),
   ]);
   setWalletSecurity(security??null);setPhoneIdentity(identity);
   setWallet({...raw,user_id:user.id,balance:Number(raw.balance??0),total_deposited:Number(raw.total_deposited??0),total_withdrawn:Number(raw.total_withdrawn??0)});
  }catch(e){setError(e instanceof Error?e.message:'Unable to load wallet');setWallet(null);setPhoneIdentity(null);}
  finally{setLoading(false);}
 },[user?.id]);
 useEffect(()=>{void fetchWallet();},[fetchWallet]);
 const requestPhoneOtp=(phone:string)=>walletPhoneAuthService.requestWalletPhoneOtp(phone);
 const verifyPhoneOtp=async(phone:string,token:string)=>{if(!wallet?.id)throw new Error('Wallet is not provisioned for this account.');const verified=await walletPhoneAuthService.verifyWalletPhoneOtp(phone,token);const identity=await walletPhoneAuthService.linkVerifiedPhoneToWallet(wallet.id,verified.phone);setPhoneIdentity(identity);setWallet(prev=>prev?{...prev,mpesa_phone:verified.phone}:prev);return identity;};
 const updatePaymentMethods=async(_mpesaPhone:string,paypalEmail:string)=>{
  if(!user||!wallet)return {success:false,error:'No wallet found'};
  try{const updated=await backendCapabilities.call<Wallet>('testagram.wallet.payment_methods.update',{mpesa_phone:phoneIdentity?.phone_e164??null,paypal_email:paypalEmail||null});setWallet(prev=>prev?{...prev,mpesa_phone:updated.mpesa_phone??prev.mpesa_phone,paypal_email:updated.paypal_email??null,updated_at:updated.updated_at??prev.updated_at}:prev);return {success:true};}
  catch(e){return {success:false,error:e instanceof Error?e.message:'Failed to update payment methods'};}
 };
 return {wallet,loading,error,phoneIdentity,phoneVerified:!!phoneIdentity?.verified_at,walletSecurity,requestPhoneOtp,verifyPhoneOtp,fetchWallet,updatePaymentMethods};
}
