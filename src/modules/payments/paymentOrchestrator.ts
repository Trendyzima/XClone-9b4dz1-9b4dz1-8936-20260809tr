import { resolveUserByPhone } from "./userResolver";
import { creditWalletFromMpesa } from "./walletService.db";

// Core orchestrator: connects M-Pesa callback → wallet credit → transaction safety

export async function processMpesaPayment(callbackData: any) {
  try {
    const result = callbackData?.Body?.stkCallback;

    const resultCode = result?.ResultCode;
    const checkoutRequestID = result?.CheckoutRequestID;

    // Extract metadata safely
    const metadata = result?.CallbackMetadata?.Item || [];

    const getValue = (name: string) =>
      metadata.find((i: any) => i.Name === name)?.Value;

    const amount = getValue("Amount");
    const phone = getValue("PhoneNumber");
    const receipt = getValue("MpesaReceiptNumber");

    // 1. Verify payment success
    if (resultCode !== 0) {
      return {
        success: false,
        message: "Payment failed",
        checkoutRequestID,
      };
    }

    if (!phone || !amount) {
      throw new Error("Invalid callback payload");
    }

    // 2. Resolve user from phone
    const user = await resolveUserByPhone(phone);

    // 3. Credit wallet (AUTO-CREDIT CORE STEP)
    const updatedWallet = await creditWalletFromMpesa(
      user.user_id,
      Number(amount),
      String(receipt ?? checkoutRequestID ?? 'mpesa-callback'),
    );

    return {
      success: true,
      message: "Wallet credited successfully",
      wallet: updatedWallet,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
  }
}
