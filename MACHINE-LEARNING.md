# Machine Learning — Patrono Seller

**Criado:** Rodada 9, complemento "Machine Learning Real". **Corrigido:** complemento pós-aprovação — precisão conceitual entre motor de ML e modelo de produção, proveniência dos dados (`MLDataOrigin`). Não substitui nem interrompe Worker Local, Digital Twin, TikTok, Chatterbox, MuseTalk ou Autopilot — é uma capacidade transversal que se apoia neles.

## Três coisas que NUNCA podem ser confundidas

| Conceito | Estado hoje | O que significa |
|---|---|---|
| **ML ENGINE** (o motor) | `IMPLEMENTED` | O algoritmo/pipeline real e funcional: extrai features, treina, calcula métricas, registra modelos, promove/reverte, integra no Autopilot. |
| **TEST MODEL** | `VALIDATED` | Um modelo treinado sobre **fixtures de teste** (`dataOrigin = TEST_FIXTURE`/`DEMO`/`SEED`/`SYNTHETIC_TEST`) só para provar que o motor funciona tecnicamente — nunca opera no workspace real. |
| **PRODUCTION MODEL** | `NOT_ACTIVE` | O modelo pessoal da proprietária, treinado **exclusivamente** com `dataOrigin = REAL_OPERATION` do próprio workspace. Ainda não existe nenhum, porque nenhum workspace real acumulou dados suficientes. |

**Nunca escrever** "o Patrono já aprendeu com as vendas" ou "modelo real da proprietária" enquanto `PRODUCTION_MODEL` for `NOT_ACTIVE`. A frase tecnicamente verdadeira, hoje, é: *o motor de Machine Learning está implementado e validado; o modelo personalizado da proprietária ainda aguarda dados reais suficientes para ser treinado e ativado.*

## Objetivo

O Patrono não deve só automatizar tarefas — deve **aprender com o que vende, o que converte e o que performa melhor**. Quanto mais ele operar, melhores devem ficar suas decisões. O sinal principal nunca é views: é **comissão e receita reais** (ver "Métricas financeiras" abaixo).

## Regra de honestidade (permanente)

Nada aqui é chamado de "Machine Learning" por marketing. Toda decisão do sistema carrega um `MLDecisionType` explícito (`lib/ml-types.ts`):

| Tipo | Significado |
|---|---|
| `RULE_BASED` | Regra fixa/if-else/peso manual — nenhum parâmetro aprendido. |
| `STATISTICAL_LEARNING` | Média/taxa real por grupo (ex.: conversão por hook) — sem modelo paramétrico. |
| `MACHINE_LEARNING` | Modelo paramétrico **treinado por otimização** sobre dados reais (regressão logística via gradiente descendente). |
| `MODEL_BASED` | Decisão derivada de um `MLModel` `ACTIVE` específico (modelId+version registrados). |

Nesta rodada, **nenhum modelo foi promovido a `ACTIVE` em produção** porque nenhum workspace real acumulou dados suficientes ainda — isso é o estado esperado e correto do cold start, não uma falha. O pipeline inteiro (feature store, readiness gate, treinamento, registry, promoção, integração no Autopilot) foi **construído e testado de ponta a ponta com dados de teste controlados** (`dataOrigin = TEST_FIXTURE`, mesma metodologia de fixture usada em todos os testes do projeto) — isso valida que o **motor** funciona; nunca é descrito como dado de produção ou como o modelo da proprietária.

## Escada de maturidade (cold start)

```
COLD START → RULE_BASED → STATISTICAL_LEARNING → MACHINE_LEARNING → CONTINUOUS LEARNING
```

`MLReadinessGate` (`lib/ml-readiness-gate.ts`) decide em qual degrau um workspace está, a partir de contagens **reais** de `MLFeatureSnapshot` rotulados:

| Estado | Critério (padrão, ajustável) |
|---|---|
| `INSUFFICIENT_DATA` | Menos de 30 amostras rotuladas. |
| `READY_FOR_STATISTICS` | 30+ amostras, mas menos de 200 (ou menos de 20 positivas). |
| `READY_FOR_ML` | 200+ amostras rotuladas, 20+ positivas. |
| `MODEL_ACTIVE` | Já existe um `MLModel` `ACTIVE` para o workspace/família. |

Um workspace novo do Patrono Seller começa em `INSUFFICIENT_DATA` — isso é esperado, não um bug.

## Proveniência dos dados (`MLDataOrigin`)

**Correção pós-aprovação**: nem todo dado rotulado conta igual. `lib/ml-types.ts` define `MLDataOrigin`: `REAL_OPERATION | TEST_FIXTURE | DEMO | SEED | SYNTHETIC_TEST`. Toda `MLFeatureSnapshot`, todo `MLTrainingRun` e todo `MLModel` carrega esse campo, **sempre obrigatório** (o Prisma Client recusa criar a linha sem ele — nunca inferido por omissão).

- O `MLReadinessGate` de **produção** (`avaliarProntidaoMLDoWorkspace`, sem sobrescrever o parâmetro `origens`) só conta amostras com `dataOrigin = REAL_OPERATION`. **250 registros `TEST_FIXTURE` + 3 publicações reais nunca resulta em `READY_FOR_ML`** — resulta em `INSUFFICIENT_DATA`, porque só as 3 amostras reais contam. Testado explicitamente (`tests/rodada9-ml-complemento.test.ts`, "CORREÇÃO: 250 amostras TEST_FIXTURE...").
- `treinarModeloConversao(workspaceId)` usa `REAL_OPERATION` por padrão — só esse caminho produz um modelo elegível para `ACTIVE`. Um segundo parâmetro (`origens`) existe **só para os testes do próprio motor de ML** validarem convergência/AUC contra dados de teste controlados — nunca chamado assim fora de teste.
- `promoverModelo()` (`lib/ml-model-registry.ts`) **recusa promover** qualquer modelo cujo `dataOrigin !== 'REAL_OPERATION'`, mesmo que suas métricas superem o baseline — testado explicitamente ("CORREÇÃO: modelo treinado com TEST_FIXTURE nunca é promovido a ACTIVE").

Os fixtures de teste continuam existindo e são úteis — validam regressão, convergência, AUC, promoção, rollback, fallback, leakage e isolamento (o "TEST_MODEL"). Eles só nunca podem ser confundidos com, nem contar para, o modelo de produção real da proprietária.

## Funil rastreado

```
Produto → Conteudo (Creative/Publication) → Sale → Commission
```

Usa o vínculo real já existente (`Sale.contentId`). **Limitação honesta**: o schema atual não persiste `Opportunity` nem eventos individuais de `Impression`/`Click` — `Conteudo.visualizacoes`/`cliquesLink` são contadores agregados, não um log evento a evento. O funil completo (Opportunity → Product → Creative → Publication → Impression/View → Click → Sale → Commission) existe na parte que o schema já suporta; a parte de eventos individuais fica para uma rodada futura, se necessário.

## Feature Store

`lib/ml-feature-store.ts` — `MLFeatureSnapshot` (Postgres, sem serviço externo), versionado (`FEATURE_VERSION`). Features nomeadas extraídas de dados reais (`extrairFeaturesDeConteudo`):

`product_price_bucket`, `commission_percentage` (sempre `null` hoje — não existe campo de % de comissão persistido em `Produto`/`AffiliateProgram`, nunca inventado), `video_duration`, `hook_type`, `cta_type`, `posting_hour`, `avatar_style` (sempre `null` — `Conteudo` ainda não registra o modo do Digital Twin usado), `channel`, `product_category`, `historical_conversion_rate`.

### Anti-leakage (regra 31)

`extrairFeaturesDeConteudo` só usa dados anteriores/conhecidos no momento da publicação. Achado real durante o desenvolvimento: sem excluir explicitamente o próprio conteúdo (`excluirContentId`), seu `createdAt` (sempre anterior à sua própria `dataPublicacao`) o fazia contaminar sua própria feature de conversão histórica — corrigido e coberto por teste (`tests/rodada9-ml-complemento.test.ts`, "SEM VAZAMENTO"). O rótulo (`extrairLabelDeConteudo`) é **sempre uma chamada separada**, feita depois que o resultado (venda/comissão) é conhecido.

## Métricas financeiras (o objetivo real)

`lib/ml-financial-metrics.ts` — nunca otimiza só para views:

`revenuePer1000Views`, `commissionPerPublication`, `clicksPerView`, `saleConversionRate`, `commissionPerClick`, `commissionPerProduct`, `commissionPerChannel`. Denominador zero vira `null` (desconhecido), nunca `0` disfarçado de "sabido".

## Primeiro modelo real: probabilidade de conversão

`lib/ml-model.ts` — **regressão logística treinada por gradiente descendente, em TypeScript puro** (zero dependência nova: sem scikit-learn/XGBoost/LightGBM, custo R$ 0,00). Padronização (z-score) + regularização L2 (necessária com poucas amostras).

**Frase tecnicamente correta**: *a regressão logística foi validada com um dataset controlado de teste (`dataOrigin = TEST_FIXTURE`) e atingiu AUC 0,84 em validação, contra 0,54 de scores aleatórios — isso demonstra que a implementação consegue aprender um sinal conhecido de verdade (peso do sinal real muito maior que o peso do ruído).*

**Nunca escrever**: "o modelo do Patrono atingiu AUC 0,84 sobre suas vendas reais" — isso ainda não aconteceu; nenhum dado de venda real da proprietária foi usado para produzir esse número.

`ExpectedCommissionValue` é **derivado** (`predictedConversionProbability × comissão estimada da oportunidade`) — não é um segundo modelo de regressão treinado nesta rodada. `calcularMAE`/`calcularRMSE` estão prontas em `lib/ml-model.ts` para quando um alvo de regressão direto for treinado.

### Pipeline de treinamento

`lib/ml-training-pipeline.ts`, `treinarModeloConversao(workspaceId)`:

1. Consulta o Readiness Gate — recusa treinar se não for `READY_FOR_ML` (nunca inventa dado).
2. Carrega `MLFeatureSnapshot` rotulados, ordenados por `capturedAt`.
3. **Split TEMPORAL** (nunca embaralhado) — 80% mais antigo treina, 20% mais recente valida. Dados sequenciais nunca usam validação cruzada aleatória (regra 30).
4. Treina a regressão logística, avalia ROC-AUC/precision/recall/calibração no split de validação.
5. Calcula um **baseline determinístico** (RULE_BASED: prevê sempre a taxa média de conversão do treino) para comparação.
6. Registra `MLTrainingRun` (sempre, sucesso ou falha) e um `MLModel` `CANDIDATE` (nunca `ACTIVE` automaticamente).

Testado ponta a ponta com 250 amostras `TEST_FIXTURE` (dados de teste controlados, nunca produção): `treinarModeloConversao` recusou treinar com 0 amostras, e treinou com sucesso com 250 (AUC 0,82 vs. baseline 0,50) — isso valida o **motor** (TEST_MODEL = VALIDATED), não produz um modelo de produção (esse exige `dataOrigin = REAL_OPERATION`, ver "Proveniência dos dados" acima).

## Primeiro modelo de PRODUÇÃO (ainda não existe)

O primeiro modelo verdadeiramente pessoal da proprietária só nasce quando o workspace real acumular, via `REAL_OPERATION`: publicações reais, cliques reais, vendas reais, comissões reais — na quantidade mínima definida pelo `MLReadinessGate` (hoje 200 amostras rotuladas, 20 positivas). Quando isso acontecer pela primeira vez, o registro (`MLTrainingRun`/`MLModel`) deve reportar, no mínimo: número de exemplos reais usados, janela temporal coberta, target (`converted`), lista de features, métricas do baseline, AUC/métrica obtida, versão do modelo e data do treinamento — os mesmos campos que `treinarModeloConversao()` já registra automaticamente em `MLTrainingRun.metrics`/`baselineMetrics`/`sampleCount`/`trainingDate`.

## Model Registry, Promotion Gate, Rollback

`lib/ml-model-registry.ts` — estados `CANDIDATE → VALIDATED → ACTIVE → DEPRECATED/ROLLED_BACK` (`lib/ml-types.ts`).

- **`avaliarPromocaoModelo`** (Promotion Gate): só aprova se o candidato tiver ROC-AUC calculável **e** superar o baseline por uma margem mínima (0,02) — nunca por empate/ruído. Testado: candidato com 0,51 vs. baseline 0,50 → rejeitado; 0,82 vs. 0,50 → aprovado.
- **`promoverModelo`**: além da margem de AUC, exige `dataOrigin = REAL_OPERATION` — um modelo `TEST_FIXTURE`/`DEMO`/`SEED`/`SYNTHETIC_TEST` é recusado mesmo com métricas excelentes (testado). Ao promover, o `ACTIVE` anterior da mesma família vira `DEPRECATED` — nunca dois modelos `ACTIVE` ao mesmo tempo.
- **`rollbackModelo`**: reverte o `ACTIVE` atual para `ROLLED_BACK` e reativa a versão `DEPRECATED` mais recente (ou nenhuma, se não houver — o Patrono volta sozinho ao baseline `RULE_BASED`, nunca fica travado esperando um modelo).

`MLPrediction` registra `modelFamily`+`modelVersion` em toda previsão — qualquer decisão sabe exatamente qual versão do modelo a gerou (regra 29).

## PatronoMLEngine e integração com o Autopilot

`lib/ml-engine.ts`, `preverOportunidades(workspaceId, candidatos)`:

- Consulta o Readiness Gate; só usa o modelo `ACTIVE` quando `MODEL_ACTIVE`.
- Sem modelo ativo, cai para `RULE_BASED` (usa `historicalConversionRate` já presente na oportunidade, quando informado — nunca inventa).
- **Fail-safe (regra 44)**: qualquer erro (modelo corrompido, artifact ausente) cai para `RULE_BASED` — nunca lança e nunca trava o Autopilot. Endurecido além do esperado: um `artifact` com dimensão dessincronizada do vetor de features atual produziria `NaN` silenciosamente (sem lançar exceção) — corrigido com uma validação explícita (`Number.isFinite` + faixa `[0,1]`), coberto por teste.
- Toda previsão é **persistida** (`MLPrediction`) e **auditada** (`registrarAuditoriaML`, reaproveita o `AuditLog` já existente — nenhuma tabela nova para o log).
- **Limitação real e documentada**: uma `AffiliateOpportunity` ainda não tem roteiro/CTA/duração/horário (isso só existe depois do Creative Factory) — a previsão nessa etapa usa um vetor de features **parcial**, com os campos desconhecidos marcados como "missing" (nunca inventados).

### Integração em `runAutopilot` (`lib/autopilot.ts`)

Mudança mínima e aditiva — `AutopilotDeps` ganhou dois campos **opcionais**: `scorer` e `mlEngine`. Sem eles, o comportamento é **idêntico** ao da Rodada 5 (verificado por teste: mesmo score, mesmo ranking). Quando `mlEngine` é informado (e nenhum `scorer` explícito), o score evolui para o composto:

```
Opportunity Score = External Market Signals + Automation Feasibility
                   + Historical Performance + ML Prediction
```

`lib/opportunity-score-composite.ts`, `MLBlendedScorer` (implementa `OpportunityScorer`, mesmo contrato de sempre) + `calcularOpportunityScoreComposto` — os 4 componentes são registrados **separadamente**, nunca escondidos atrás de um número só. Pesos escolhidos para reproduzir exatamente 0,55/0,45 (Rodada 5) quando os dois componentes novos ainda não existem (a maioria dos casos hoje).

`explicarEmLinguagemSimples()` gera a explicação para a usuária sem jargão técnico (nunca "ROC-AUC"/"feature importance" na tela principal).

## Aprendizado de criativo (hook/CTA/roteiro)

`lib/ml-hook-classifier.ts`/`lib/ml-cta-classifier.ts` — classificação **RULE_BASED** (casamento de padrões/regex, nada aprendido) dos tipos definidos na regra 14/15. `lib/ml-creative-learning.ts` correlaciona esses grupos com a conversão **real** (`STATISTICAL_LEARNING`) — nunca reporta uma taxa de um grupo com menos de 5 amostras (`MINIMO_AMOSTRAS_POR_GRUPO`). `extrairFeaturesDoRoteiro()` extrai tamanho/número de palavras/posição relativa do CTA/presença do produto no texto (RULE_BASED, extração pura).

## Digital Twin: aprendizado de apresentação, nunca de identidade

`lib/ml-digital-twin-learning.ts` — o ML pode, no futuro, aprender duração ideal da fala, proporção avatar/B-roll, posição da legenda, timing do CTA. **Nunca** aprende/altera rosto, voz ou qualquer característica pessoal — isso pertence exclusivamente ao `DigitalTwinIdentityLock` (`lib/digital-twin-identity-lock.ts`), que não foi tocado nesta rodada.

`nuncaAlterarIdentidade()` é uma barreira defensiva: lança erro imediatamente se qualquer sugestão desta camada incluir um campo cujo nome contenha "face"/"rosto"/"voice"/"voz"/"identity"/"biometr" — testado.

**Honestidade sobre o escopo real**: `Conteudo` ainda não registra qual modo do Digital Twin foi usado (`avatar_style`) nem a duração isolada da fala do avatar — sem esse metadado estruturado, `aprenderApresentacaoDigitalTwin()` devolve honestamente vazio (`RULE_BASED`, sem sugestão), nunca inventado.

## Privacidade

`lib/ml-privacy.ts`, `verificarSemDadosBiometricos()` — barreira estrutural chamada antes de qualquer persistência de feature (`salvarFeatureSnapshot`): nenhum campo cujo nome sugira áudio bruto/rosto bruto/referência de voz/identidade pode entrar num objeto de features de performance. Testado: tentar salvar um snapshot com `referenceAudio`/`faceImage` lança erro e a persistência é recusada.

## Isolamento por workspace

Todo modelo/previsão/feature/experimento é escopado por `workspaceId` (schema: `MLTrainingRun`, `MLModel`, `MLPrediction`, `MLFeatureSnapshot`, `CreativeExperiment` — todos com `workspaceId` obrigatório e FK). Testado explicitamente: um modelo `ACTIVE` do workspace A nunca aparece como ativo para o workspace B; o Readiness Gate de um workspace nunca conta amostras de outro. Um modelo **global** agregando vários workspaces exigiria política própria de anonimização/agregação — **não implementado nesta rodada** (regra 39).

## A/B Testing e Exploração/Aproveitamento

`lib/creative-experiment.ts`, `CreativeExperiment` (Postgres, sem serviço externo) — variantes A/B por dimensão (hook, CTA, duração, avatar vs. B-roll, etc.). Estratégia **epsilon-greedy** (simples, auditável, gratuita — nunca Multi-Armed Bandit sofisticado sem dados para justificar): com probabilidade `epsilon` explora (variante aleatória), senão aproveita (escolhe a variante com melhor taxa observada). `concluirExperimento()` só declara vencedor com pelo menos 20 amostras por variante (`MINIMO_AMOSTRAS_PARA_VENCEDOR`) — nunca conclui de poucos dados.

## Validação e métricas

`lib/ml-model.ts`: `calcularRocAuc` (contagem de pares concordantes, `null` quando só há uma classe — nunca um número inventado), `calcularPrecisionRecall`, `calcularCalibracao` (previsto médio vs. observado médio por bin), `calcularMAE`/`calcularRMSE` (preparadas para regressão direta futura). Split sempre **temporal**, nunca aleatório, para dados sequenciais (regra 30).

## Drift

Não implementado nesta rodada (regra 35 permite adiar) — os `metrics`/`baselineMetrics` já registrados em cada `MLTrainingRun`/`MLModel` são a base para, numa rodada futura, comparar a performance do modelo ativo ao longo do tempo e detectar degradação (ex.: uma categoria que convertia bem parar de converter).

## Explicabilidade

`explicarEmLinguagemSimples()` (`lib/opportunity-score-composite.ts`) — nunca expõe "ROC-AUC"/"feature importance"/"gradient boosting" na interface principal. Exemplo do formato:

```
Escolhi "Fone X" porque:
- Tendência e comissão no mercado: 73/100
- Consigo fazer isso sozinho, sem te incomodar: 100/100
- Histórico real de conversão nessa categoria: 62/100
```

## Interface (futura) — linguagem enquanto não há dados suficientes

Enquanto `PRODUCTION_MODEL = NOT_ACTIVE`, qualquer tela deve mostrar algo simples e honesto, como *"Patrono está começando a aprender"* ou *"Coletando resultados para personalizar suas decisões"*. **Nunca** exibir algo como "Machine Learning já otimizou suas vendas" antes de isso ser verdade (antes de existir um `MLModel` `ACTIVE` com `dataOrigin = REAL_OPERATION`). Nenhuma tela de ML foi implementada nesta rodada — esta seção é só a diretriz para quando ela existir.

## ML Audit Log

Reaproveita o `AuditLog` já existente (`lib/ml-audit.ts`, `registrarAuditoriaML`) — nenhuma tabela nova. Cada previsão registra `decisionType`/`modelFamily`/`modelVersion`/probabilidade/valor esperado — nunca secrets, nunca biometria.

## Custo

R$ 0,00 — nenhuma biblioteca nova, nenhum serviço de ML pago (Vertex AI/SageMaker/Azure ML/Databricks não avaliados nem contratados). Tudo roda no Postgres/Node já existentes.

## O que está EXECUTADO REALMENTE vs. PREPARADO

- **ML_ENGINE = IMPLEMENTED, testado com dados de teste controlados** (`dataOrigin = TEST_FIXTURE`, metodologia padrão de fixture do projeto, nunca produção fingida): feature store, readiness gate, treinamento (convergência real, AUC real), model registry (promoção/rollback), integração no Autopilot (ranking muda de verdade, fallback funciona de verdade), correlação hook/CTA, CreativeExperiment (epsilon-greedy real, vencedor real), guardas de privacidade/identidade e de proveniência de dados (fixture nunca conta para prontidão/promoção de produção).
- **TEST_MODEL = VALIDATED** — o modelo de regressão logística treinado sobre os 250 fixtures de teste prova que o motor aprende um sinal real (AUC 0,84/0,82 conforme o cenário) — isso é validação técnica do motor, nunca um modelo de produção.
- **PRODUCTION_MODEL = NOT_ACTIVE** — nenhum workspace real (fora de teste) acumulou as 200+ amostras `REAL_OPERATION` necessárias. Isso é o estado correto e esperado do cold start, não uma limitação escondida.
- **Não implementado nesta rodada**: drift detection sofisticado, aprendizado de apresentação do Digital Twin (falta metadado estruturado no schema), Multi-Armed Bandit além de epsilon-greedy, modelo de regressão direto para `ExpectedCommissionValue` (hoje derivado), tela de UI mostrando o status de aprendizado.
