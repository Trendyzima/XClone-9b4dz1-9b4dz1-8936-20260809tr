import type {
  ClientServerOptions,
  PostgrestResponseSuccess,
  PostgrestSingleResponse,
} from '@supabase/postgrest-js';

declare module '@supabase/postgrest-js' {
  interface PostgrestBuilder<
    ClientOptions extends ClientServerOptions,
    Result,
    ThrowOnError extends boolean = false,
  > {
    /** Promise-compatible catch helper retained for legacy callers. */
    catch<TResult = never>(
      onrejected?:
        | ((
            reason: any,
          ) => TResult | PromiseLike<TResult>)
        | null,
    ): PromiseLike<
      | (ThrowOnError extends true
          ? PostgrestResponseSuccess<Result>
          : PostgrestSingleResponse<Result>)
      | TResult
    >;
  }
}
