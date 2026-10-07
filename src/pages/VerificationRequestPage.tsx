        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
          <p className="font-bold">Identity verification is already built into Testagram.</p>
          <p className="mt-1 text-muted-foreground">
            Testagram uses the separate identity-first KYC flow for account uniqueness and security. Do not upload national-ID photos here; Testagram does not store them.
          </p>
        </div>

        {/* Summary + Submit */}
        <div className={`rounded-2xl border-2 ${activeStyles.border} ${activeStyles.bg} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm">Order Summary</span>
            <div className="flex items-center gap-1.5">
              {activeTier.icon}
              <span className="font-bold">{activeTier.label}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground border-t border-border pt-3">
            <span>Monthly subscription</span>
            <span className="text-2xl font-extrabold text-foreground">${activeTier.price}</span>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={uploading || loadingStatus}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {uploading
            ? <><Loader2 className="w-5 h-5 animate-spin" />Submitting…</>
            : <><BadgeCheck className="w-5 h-5" />Submit Verification Request</>
          }
        </button>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Verification is a monthly subscription. The badge remains active only while the monthly entitlement is active; the platform owner is verified permanently.
        </p>
      </div>
    </div>
  );
}
