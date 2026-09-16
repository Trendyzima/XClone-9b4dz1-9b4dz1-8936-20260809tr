import type {
  ClientServerOptions,
  GenericSchema,
  PostgrestMaybeSingleResponse,
  PostgrestSingleResponse,
} from '@supabase/postgrest-js';

declare module '@supabase/postgrest-js' {
  /**
   * Compatibility surface for the PostgREST builder declarations consumed by
   * this application. The installed SDK runtime exposes the full fluent
   * builder, but the resolved declaration surface can lose inherited
   * transform/PromiseLike members under this repository's TypeScript setup.
   *
   * Keep this augmentation limited to the public fluent/query contract. It
   * does not change runtime behavior or replace the SDK implementation.
   */
  interface PostgrestFilterBuilder<
    ClientOptions extends ClientServerOptions,
    Schema extends GenericSchema,
    Row extends Record<string, unknown>,
    Result,
    RelationName = unknown,
    Relationships = unknown,
    Method = unknown,
  > {
    then<TResult1 = PostgrestSingleResponse<Result>, TResult2 = never>(
      onfulfilled?:
        | ((value: PostgrestSingleResponse<Result>) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2>;

    catch<TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): PromiseLike<PostgrestSingleResponse<Result> | TResult>;

    select(...args: any[]): PostgrestFilterBuilder<ClientOptions, Schema, Row, any, RelationName, Relationships, Method>;
    order(...args: any[]): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result, RelationName, Relationships, Method>;
    limit(...args: any[]): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result, RelationName, Relationships, Method>;
    range(...args: any[]): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result, RelationName, Relationships, Method>;
    single(): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result, RelationName, Relationships, Method>;
    maybeSingle(): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result | null, RelationName, Relationships, Method>;
    csv(): any;
    explain(...args: any[]): any;
    geojson(): any;
    abortSignal(...args: any[]): PostgrestFilterBuilder<ClientOptions, Schema, Row, Result, RelationName, Relationships, Method>;
    throwOnError(): any;
    returns<NewResult>(): any;
    overrideTypes<NewResult, Options extends { merge?: boolean } = { merge: true }>(): any;
    maxAffected(...args: any[]): any;
    rollback(): any;
    setHeader(...args: any[]): any;
  }
}
