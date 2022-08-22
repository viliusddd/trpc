import { TRPCError } from '../../error/TRPCError';
import { getCauseFromUnknown, getErrorFromUnknown } from '../../error/utils';
import { MaybePromise } from '../../types';
import { MiddlewareFunction, MiddlewareResult } from '../middleware';
import { Parser, inferParser } from '../parser';
import {
  MutationProcedure,
  Procedure,
  ProcedureParams,
  QueryProcedure,
  SubscriptionProcedure,
} from '../procedure';
import { ProcedureType } from '../types';
import { RootConfig } from './config';
import { ParseFn, getParseFn } from './getParseFn';
import { mergeWithoutOverrides } from './mergeWithoutOverrides';
import { ResolveOptions, middlewareMarker } from './utils';
import { DefaultValue as FallbackValue, Overwrite, UnsetMarker } from './utils';

type CreateProcedureReturnInput<
  TPrev extends ProcedureParams,
  TNext extends ProcedureParams,
> = ProcedureBuilder<{
  _config: TPrev['_config'];
  _meta: TPrev['_meta'];
  _ctx_in: TPrev['_ctx_in'];
  _ctx_out: Overwrite<TPrev['_ctx_out'], TNext['_ctx_out']>;
  _input_in: FallbackValue<TNext['_input_in'], TPrev['_input_in']>;
  _input_out: FallbackValue<TNext['_input_out'], TPrev['_input_out']>;
  _output_in: FallbackValue<TNext['_output_in'], TPrev['_output_in']>;
  _output_out: FallbackValue<TNext['_output_out'], TPrev['_output_out']>;
}>;

type OverwriteIfDefined<T, K> = UnsetMarker extends T ? K : Overwrite<T, K>;

export interface ProcedureBuilder<TParams extends ProcedureParams> {
  /**
   * Add an input parser to the procedure.
   */
  input<$TParser extends Parser>(
    schema: $TParser,
  ): ProcedureBuilder<{
    _config: TParams['_config'];
    _meta: TParams['_meta'];
    _ctx_in: TParams['_ctx_in'];
    _ctx_out: TParams['_ctx_out'];
    _input_in: OverwriteIfDefined<
      TParams['_input_in'],
      inferParser<$TParser>['in']
    >;
    _input_out: OverwriteIfDefined<
      TParams['_input_out'],
      inferParser<$TParser>['out']
    >;
    _output_in: TParams['_output_in'];
    _output_out: TParams['_output_out'];
  }>;
  /**
   * Add an output parser to the procedure.
   */
  output<$TParser extends Parser>(
    schema: $TParser,
  ): ProcedureBuilder<{
    _config: TParams['_config'];
    _meta: TParams['_meta'];
    _ctx_in: TParams['_ctx_in'];
    _ctx_out: TParams['_ctx_out'];
    _input_in: TParams['_input_in'];
    _input_out: TParams['_input_out'];
    _output_in: inferParser<$TParser>['in'];
    _output_out: inferParser<$TParser>['out'];
  }>;
  /**
   * Add a meta data to the procedure.
   */
  meta(meta: TParams['_meta']): ProcedureBuilder<TParams>;
  /**
   * Add a middleware to the procedure.
   */
  use<$TParams extends ProcedureParams>(
    fn: MiddlewareFunction<TParams, $TParams>,
  ): CreateProcedureReturnInput<TParams, $TParams>;
  /**
   * Extend the procedure with another procedure.
   * @warning The TypeScript inference fails when chaining concatenated procedures.
   */
  unstable_concat<$ProcedureReturnInput extends AnyProcedureBuilder>(
    proc: $ProcedureReturnInput,
  ): $ProcedureReturnInput extends ProcedureBuilder<infer $TParams>
    ? CreateProcedureReturnInput<TParams, $TParams>
    : never;
  /**
   * Query procedure
   */
  query<$TOutput>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<FallbackValue<TParams['_output_in'], $TOutput>>,
  ): UnsetMarker extends TParams['_output_out']
    ? QueryProcedure<
        Overwrite<
          TParams,
          {
            _output_in: $TOutput;
            _output_out: $TOutput;
          }
        >
      >
    : QueryProcedure<TParams>;

  /**
   * Mutation procedure
   */
  mutation<$TOutput>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<FallbackValue<TParams['_output_in'], $TOutput>>,
  ): UnsetMarker extends TParams['_output_out']
    ? MutationProcedure<
        Overwrite<
          TParams,
          {
            _output_in: $TOutput;
            _output_out: $TOutput;
          }
        >
      >
    : MutationProcedure<TParams>;

  /**
   * Mutation procedure
   */
  subscription<$TOutput>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<FallbackValue<TParams['_output_in'], $TOutput>>,
  ): UnsetMarker extends TParams['_output_out']
    ? SubscriptionProcedure<
        Overwrite<
          TParams,
          {
            _output_in: $TOutput;
            _output_out: $TOutput;
          }
        >
      >
    : SubscriptionProcedure<TParams>;
  /**
   * @internal
   */
  _def: {
    inputs: Parser[];
    output?: Parser;
    meta?: Record<string, unknown>;
    resolver?: ProcedureBuilderResolver;
    middlewares: ProcedureBuilderMiddleware[];
    mutation?: boolean;
    query?: boolean;
    subscription?: boolean;
  };
}

type AnyProcedureBuilder = ProcedureBuilder<any>;
export type ProcedureBuilderDef = AnyProcedureBuilder['_def'];

export type ProcedureBuilderMiddleware = MiddlewareFunction<any, any>;

export type ProcedureBuilderResolver = (
  opts: ResolveOptions<any>,
) => Promise<unknown>;

function createNewBuilder(
  def1: ProcedureBuilderDef,
  def2: Partial<ProcedureBuilderDef>,
) {
  const { middlewares = [], inputs, ...rest } = def2;

  // TODO: maybe have a fn here to warn about calls
  return createBuilder({
    ...mergeWithoutOverrides(def1, rest),
    inputs: [...def1.inputs, ...(inputs ?? [])],
    middlewares: [...def1.middlewares, ...middlewares],
  } as any);
}

export function createBuilder<TConfig extends RootConfig>(
  initDef?: ProcedureBuilderDef,
): ProcedureBuilder<{
  _config: TConfig;
  _ctx_in: TConfig['ctx'];
  _ctx_out: TConfig['ctx'];
  _input_in: UnsetMarker;
  _input_out: UnsetMarker;
  _output_in: UnsetMarker;
  _output_out: UnsetMarker;
  _meta: TConfig['meta'];
}> {
  const _def: ProcedureBuilderDef = initDef || {
    inputs: [],
    middlewares: [],
  };

  return {
    _def,
    input(input) {
      const parser = getParseFn(input);
      return createNewBuilder(_def, {
        inputs: [input],
        middlewares: [createInputMiddleware(parser)],
      }) as AnyProcedureBuilder;
    },
    output(output: Parser) {
      const parseOutput = getParseFn(output);
      return createNewBuilder(_def, {
        output,
        middlewares: [createOutputMiddleware(parseOutput)],
      }) as AnyProcedureBuilder;
    },
    meta(meta) {
      return createNewBuilder(_def, {
        meta: meta as Record<string, unknown>,
      }) as AnyProcedureBuilder;
    },
    unstable_concat(builder) {
      return createNewBuilder(_def, builder._def) as any;
    },
    use(middleware) {
      return createNewBuilder(_def, {
        middlewares: [middleware],
      }) as AnyProcedureBuilder;
    },
    query(resolver) {
      return createResolver(
        { ..._def, query: true },
        resolver,
      ) as QueryProcedure<any>;
    },
    mutation(resolver) {
      return createResolver(
        { ..._def, mutation: true },
        resolver,
      ) as MutationProcedure<any>;
    },
    subscription(resolver) {
      return createResolver(
        { ..._def, subscription: true },
        resolver,
      ) as SubscriptionProcedure<any>;
    },
  };
}

export function createInputMiddleware<T>(
  parse: ParseFn<T>,
): ProcedureBuilderMiddleware {
  return async function inputMiddleware({ next, rawInput, input }) {
    let parsedInput: ReturnType<typeof parse>;
    try {
      parsedInput = await parse(rawInput);
    } catch (cause) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        cause: getCauseFromUnknown(cause),
      });
    }
    const combinedInput = {
      ...parsedInput,
      ...(input ?? {}),
    };
    // TODO fix this typing?
    return next({ input: combinedInput } as any);
  };
}

export function createOutputMiddleware<T>(
  parse: ParseFn<T>,
): ProcedureBuilderMiddleware {
  return async function outputMiddleware({ next }) {
    const result = await next();
    if (!result.ok) {
      // pass through failures without validating
      return result;
    }
    try {
      const data = await parse(result.data);
      return {
        ...result,
        data,
      };
    } catch (cause) {
      throw new TRPCError({
        message: 'Output validation failed',
        code: 'INTERNAL_SERVER_ERROR',
        cause: getCauseFromUnknown(cause),
      });
    }
  };
}

function createResolver(
  _def: ProcedureBuilderDef,
  resolver: (opts: ResolveOptions<any>) => MaybePromise<any>,
) {
  const finalBuilder = createNewBuilder(_def, {
    resolver,
    middlewares: [
      async function resolveMiddleware(opts) {
        const data = await resolver(opts);
        return {
          marker: middlewareMarker,
          ok: true,
          data,
          ctx: opts.ctx,
        } as const;
      },
    ],
  });

  return createProcedureCaller(finalBuilder._def);
}

/**
 * @internal
 */
export interface ProcedureCallOptions {
  ctx: unknown;
  rawInput: unknown;
  input?: unknown;
  path: string;
  type: ProcedureType;
}

const codeblock = `
If you want to call this function on the server, you do the following:
This is a client-only function.

const caller = appRouter.createCaller({
  /* ... your context */
});

const result = await caller.call('myProcedure', input);
`.trim();

function createProcedureCaller(_def: ProcedureBuilderDef): Procedure<any> {
  const procedure = async function resolve(opts: ProcedureCallOptions) {
    // is direct server-side call
    if (!opts || !('rawInput' in opts)) {
      throw new Error(codeblock);
    }

    // run the middlewares recursively with the resolver as the last one
    const callRecursive = async (
      callOpts: { ctx: any; index: number; input?: unknown } = {
        index: 0,
        ctx: opts.ctx,
      },
    ): Promise<MiddlewareResult<any>> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const middleware = _def.middlewares[callOpts.index]!;
        const result = await middleware({
          ctx: callOpts.ctx,
          type: opts.type,
          path: opts.path,
          rawInput: opts.rawInput,
          meta: _def.meta,
          input: callOpts.input,
          next: async (nextOpts?: { ctx: any; input?: any }) => {
            return await callRecursive({
              index: callOpts.index + 1,
              ctx:
                nextOpts && 'ctx' in nextOpts
                  ? { ...callOpts.ctx, ...nextOpts.ctx }
                  : callOpts.ctx,
              input:
                nextOpts && 'input' in nextOpts
                  ? nextOpts.input
                  : callOpts.input,
            });
          },
        });
        return result;
      } catch (cause) {
        return {
          ok: false,
          error: getErrorFromUnknown(cause),
          marker: middlewareMarker,
        };
      }
    };

    // there's always at least one "next" since we wrap this.resolver in a middleware
    const result = await callRecursive();

    if (!result) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'No result from middlewares - did you forget to `return next()`?',
      });
    }
    if (!result.ok) {
      // re-throw original error
      throw result.error;
    }
    return result.data;
  };
  procedure._def = _def;
  procedure.meta = _def.meta;

  return procedure as Procedure<any>;
}