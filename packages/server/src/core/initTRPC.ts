import { mergeRoutersGeneric } from './internals/__generated__/mergeRoutersGeneric';
import {
  DefaultErrorShape,
  ErrorFormatter,
  ErrorFormatterShape,
  defaultFormatter,
} from '../error/formatter';
import {
  CombinedDataTransformer,
  DataTransformerOptions,
  DefaultDataTransformer,
  defaultTransformer,
  getDataTransformer,
} from '../transformer';
import {
  CreateInitGenerics,
  CreateRootConfig,
  InitGenerics,
  InitOptions,
} from './internals/config';
import { createBuilder } from './internals/procedureBuilder';
import { PickFirstDefined, ValidateShape } from './internals/utils';
import { createMiddlewareFactory } from './middleware';
import { createRouterFactory } from './router';

class TRPCBuilder<TParams extends Partial<InitGenerics> = {}> {
  context<TNewContext extends InitGenerics['ctx']>() {
    return new TRPCBuilder<Omit<TParams, 'ctx'> & { ctx: TNewContext }>();
  }
  meta<TNewMeta extends InitGenerics['meta']>() {
    return new TRPCBuilder<Omit<TParams, 'meta'> & { meta: TNewMeta }>();
  }
  create<
    TOptions extends Partial<
      InitOptions<{
        ctx: TParams['ctx'] extends undefined
          ? {}
          : NonNullable<TParams['ctx']>;
        meta: TParams['meta'] extends undefined
          ? {}
          : NonNullable<TParams['meta']>;
      }>
    >,
  >(
    options?:
      | ValidateShape<
          TOptions,
          Partial<
            InitOptions<{
              ctx: TParams['ctx'] extends undefined
                ? {}
                : NonNullable<TParams['ctx']>;
              meta: TParams['meta'] extends undefined
                ? {}
                : NonNullable<TParams['meta']>;
            }>
          >
        >
      | undefined,
  ) {
    return createTRPCInner<TParams>()<TOptions>(options);
  }
}

/**
 * Initialize tRPC - be done exactly once per backend
 */
export const initTRPC = new TRPCBuilder();

function createTRPCInner<TParams extends Partial<InitGenerics>>() {
  type $Generics = CreateInitGenerics<{
    ctx: TParams['ctx'] extends undefined ? {} : NonNullable<TParams['ctx']>;
    meta: TParams['meta'] extends undefined ? {} : NonNullable<TParams['meta']>;
  }>;

  type $Context = $Generics['ctx'];
  type $Meta = PickFirstDefined<$Generics['meta'], undefined>;
  type $Options = Partial<InitOptions<$Generics>>;

  return function initTRPCInner<TOptions extends $Options>(
    options?: ValidateShape<TOptions, $Options>,
  ) {
    type $Formatter = PickFirstDefined<
      TOptions['errorFormatter'],
      ErrorFormatter<$Context, DefaultErrorShape>
    >;
    type $Transformer = TOptions['transformer'] extends DataTransformerOptions
      ? TOptions['transformer'] extends DataTransformerOptions
        ? CombinedDataTransformer
        : DefaultDataTransformer
      : DefaultDataTransformer;
    type $ErrorShape = ErrorFormatterShape<$Formatter>;

    type $Config = CreateRootConfig<{
      ctx: $Context;
      meta: $Meta;
      errorShape: $ErrorShape;
      transformer: $Transformer;
    }>;

    const errorFormatter = options?.errorFormatter ?? defaultFormatter;
    const transformer = getDataTransformer(
      options?.transformer ?? defaultTransformer,
    ) as $Transformer;
    const _config: $Config = {
      transformer,
      errorShape: null as any,
      ctx: null as any,
      meta: null as any,
    };
    return {
      /**
       * These are just types, they can't be used
       * @internal
       */
      _config,
      /**
       * Builder object for creating procedures
       */
      procedure: createBuilder<$Config>(),
      /**
       * Create reusable middlewares
       */
      middleware: createMiddlewareFactory<$Config>(),
      /**
       * Create a router
       */
      router: createRouterFactory<$Config>({
        errorFormatter,
        transformer,
      }),
      /**
       * Merge Routers
       */
      mergeRouters: mergeRoutersGeneric,
    };
  };
}