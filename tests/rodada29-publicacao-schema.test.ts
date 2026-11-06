/**
 * P1.0 Etapa 2.b — revisão do schema e da migration, ANTES de aplicar.
 *
 * Nada aqui toca banco. São dois grupos:
 *
 *   1. O schema e o SQL dizem o que a gente acha que dizem — lidos como
 *      texto, que é tudo o que eles são até a migration rodar.
 *   2. A derivação do estado de rastreamento sobre a publicação persistida
 *      é uma função pura, testada antes de existir dado.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESTADOS_DA_PUBLICACAO } from '../lib/publicacao-contrato'
import { derivarEstadoDaPublicacaoPersistida } from '../lib/rastreamento-da-publicacao'

const RAIZ = join(__dirname, '..')
const SCHEMA = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(RAIZ, 'prisma/migrations/20260922120000_publicacao_entidade_de_distribuicao/migration.sql'),
  'utf8'
)
/** O schema sem comentários — senão um `//` explicativo vira "declaração". */
const SCHEMA_CRU = SCHEMA.split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('//'))
  .join('\n')

/** O SQL sem os comentários — senão um `--` explicativo vira "código". */
const SQL = MIGRATION.split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')

// ── Vocabulário em dois lugares, obrigado a bater ───────────────────────

describe('Enum do banco e contrato não podem divergir', () => {
  const enumDoSchema = (() => {
    const m = SCHEMA.match(/enum EstadoDaPublicacao \{([^}]+)\}/)
    assert.ok(m, 'o enum precisa existir no schema')
    return m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  })()

  test('o schema declara exatamente os estados do contrato, na mesma ordem', () => {
    assert.deepEqual(enumDoSchema, [...ESTADOS_DA_PUBLICACAO])
  })

  test('o SQL cria o tipo com os mesmos valores', () => {
    const m = SQL.match(/CREATE TYPE "EstadoDaPublicacao" AS ENUM \(([^)]+)\)/)
    assert.ok(m, 'o CREATE TYPE precisa existir')
    const valores = m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
    assert.deepEqual(valores, [...ESTADOS_DA_PUBLICACAO])
  })

  test('a coluna usa o enum, não TEXT', () => {
    assert.match(SQL, /"estado" "EstadoDaPublicacao" NOT NULL DEFAULT 'PREPARADA'/)
    assert.ok(!/"estado" TEXT/.test(SQL), 'estado não pode ser TEXT')
  })

  test('nenhum CHECK escrito à mão — ele sumiria num migrate reset', () => {
    assert.ok(!/\bCHECK\s*\(/i.test(SQL))
  })

  test('dataOrigin continua TEXT, junto do vocabulário das outras tabelas', () => {
    assert.match(SQL, /"dataOrigin" TEXT NOT NULL DEFAULT 'UNVERIFIED'/)
  })
})

// ── Índices: os que ficaram e os que saíram ─────────────────────────────

describe('Índices — nenhum duplicado', () => {
  const indices = [...SQL.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map((m) => m[1])

  test('a lista é exatamente esta', () => {
    assert.deepEqual(indices.sort(), [
      'Conteudo_id_workspaceId_key',
      'LinkDinamico_publicacaoId_workspaceId_key',
      'Publicacao_id_workspaceId_key',
      'Publicacao_workspaceId_chaveDaTentativa_key',
      'Publicacao_workspaceId_contentId_createdAt_idx',
      'Publicacao_workspaceId_estado_idx',
      'Publicacao_workspaceId_provider_publicacaoExternaId_key',
    ])
  })

  test('o UNIQUE(publicacaoId) sozinho foi REMOVIDO — era redundante', () => {
    // O composto já garante "um link por publicação", porque a FK composta
    // obriga os dois links a terem o mesmo workspaceId da publicação.
    assert.ok(!indices.includes('LinkDinamico_publicacaoId_key'))
    assert.ok(!/CREATE UNIQUE INDEX "[^"]*" ON "LinkDinamico"\("publicacaoId"\)/.test(SQL))
  })

  test('nenhum índice repete o prefixo exato de outro', () => {
    const colunas = [...SQL.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"\(([^)]+)\)/g)].map(
      (m) => ({ tabela: m[1], cols: m[2] })
    )
    for (const a of colunas) {
      for (const b of colunas) {
        if (a === b || a.tabela !== b.tabela) continue
        assert.notEqual(a.cols, b.cols, `índice duplicado em ${a.tabela}: ${a.cols}`)
      }
    }
  })

  test('idempotência primária: workspaceId + chaveDaTentativa', () => {
    assert.match(
      SQL,
      /CREATE UNIQUE INDEX "Publicacao_workspaceId_chaveDaTentativa_key" ON "Publicacao"\("workspaceId", "chaveDaTentativa"\)/
    )
  })

  test('idempotência externa: workspaceId + provider + publicacaoExternaId', () => {
    assert.match(
      SQL,
      /CREATE UNIQUE INDEX "Publicacao_workspaceId_provider_publicacaoExternaId_key" ON "Publicacao"\("workspaceId", "provider", "publicacaoExternaId"\)/
    )
  })

  test('a limitação do id externo por conta está registrada, não esquecida', () => {
    assert.match(MIGRATION, /LIMITACAO REGISTRADA/)
    assert.match(MIGRATION, /unico por conta\/loja/)
  })
})

// ── FKs compostas e os alvos que elas exigem ────────────────────────────

describe('Isolamento multi-workspace defendido pelo banco', () => {
  test('Publicacao(contentId, workspaceId) → Conteudo(id, workspaceId)', () => {
    assert.match(
      SQL,
      /FOREIGN KEY \("contentId", "workspaceId"\) REFERENCES "Conteudo"\("id", "workspaceId"\)/
    )
  })

  test('LinkDinamico(publicacaoId, workspaceId) → Publicacao(id, workspaceId)', () => {
    assert.match(
      SQL,
      /FOREIGN KEY \("publicacaoId", "workspaceId"\) REFERENCES "Publicacao"\("id", "workspaceId"\)/
    )
  })

  test('cada FK composta tem o UNIQUE do lado REFERENCIADO', () => {
    // Sem isto o Postgres recusa a própria FK.
    assert.match(SQL, /CREATE UNIQUE INDEX "Conteudo_id_workspaceId_key" ON "Conteudo"\("id", "workspaceId"\)/)
    assert.match(SQL, /CREATE UNIQUE INDEX "Publicacao_id_workspaceId_key" ON "Publicacao"\("id", "workspaceId"\)/)
  })

  test('o UNIQUE do alvo vem ANTES da FK que o usa', () => {
    assert.ok(
      SQL.indexOf('Conteudo_id_workspaceId_key') < SQL.indexOf('Publicacao_contentId_workspaceId_fkey')
    )
    assert.ok(
      SQL.indexOf('Publicacao_id_workspaceId_key') < SQL.indexOf('LinkDinamico_publicacaoId_workspaceId_fkey')
    )
  })

  test('apagar publicação com link é recusado, não orfanado', () => {
    assert.match(
      SQL,
      /"LinkDinamico_publicacaoId_workspaceId_fkey"[^;]*ON DELETE RESTRICT/
    )
  })
})

// ── Aditiva de verdade ──────────────────────────────────────────────────

describe('Migration aditiva — nada antigo é tocado', () => {
  test('nenhum DROP, RENAME, UPDATE, DELETE ou SET NOT NULL', () => {
    for (const perigo of [
      /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i,
      /\bRENAME\b/i,
      /^\s*UPDATE\s/im,
      /^\s*DELETE\s+FROM/im,
      /SET\s+NOT\s+NULL/i,
      /\bALTER\s+COLUMN\b/i,
    ]) {
      assert.ok(!perigo.test(SQL), `a migration não pode conter ${perigo}`)
    }
  })

  test('a única coluna nova em tabela existente nasce opcional', () => {
    assert.match(SQL, /ALTER TABLE "LinkDinamico" ADD COLUMN\s+"publicacaoId" TEXT;/)
    assert.ok(!/ADD COLUMN\s+"publicacaoId" TEXT NOT NULL/.test(SQL))
  })

  test('nenhum backfill de Publicacao', () => {
    assert.ok(!/INSERT\s+INTO\s+"Publicacao"/i.test(SQL))
    assert.ok(!/\bSELECT\b/i.test(SQL), 'nenhuma leitura — logo, nenhuma derivação de histórico')
  })

  test('o schema não ganhou publicacaoId em Sale, EventoLink ou Commission', () => {
    for (const modelo of ['Sale', 'EventoLink', 'Commission']) {
      const m = SCHEMA_CRU.match(new RegExp(`model ${modelo} \\{[\\s\\S]*?\\n\\}`))
      assert.ok(m, `modelo ${modelo} não encontrado`)
      assert.ok(
        !/publicacaoId/.test(m[0]),
        `${modelo} não pode duplicar a publicação — ela deriva pela cadeia do clique`
      )
    }
  })

  test('produtoId não foi duplicado em Publicacao', () => {
    const m = SCHEMA_CRU.match(/model Publicacao \{[\s\S]*?\n\}/)
    assert.ok(m && !/produtoId/.test(m[0]), 'o produto deriva de Conteudo.produtoId')
  })
})

// ── Derivação: distribuída ≠ rastreada ──────────────────────────────────

describe('Estado de rastreamento derivado da publicação persistida', () => {
  const t0 = new Date('2026-09-20T10:00:00.000Z')
  const antes = new Date('2026-09-20T09:00:00.000Z')
  const depois = new Date('2026-09-20T11:00:00.000Z')

  test('link criado ANTES da distribuição = RASTREADA', () => {
    assert.equal(
      derivarEstadoDaPublicacaoPersistida({
        estado: 'DISTRIBUIDA',
        distribuidaEm: t0,
        link: { criadoEm: antes },
      }),
      'RASTREADA'
    )
  })

  test('link criado DEPOIS da distribuição NÃO vira rastreada', () => {
    // É a proteção central: anexar link depois não reescreve a história do
    // post que já saiu com o link direto.
    assert.equal(
      derivarEstadoDaPublicacaoPersistida({
        estado: 'DISTRIBUIDA',
        distribuidaEm: t0,
        link: { criadoEm: depois },
      }),
      'NAO_RASTREADA_COM_FALLBACK'
    )
  })

  test('mesmo instante conta como rastreada — a desigualdade é <=', () => {
    assert.equal(
      derivarEstadoDaPublicacaoPersistida({ estado: 'DISTRIBUIDA', distribuidaEm: t0, link: { criadoEm: t0 } }),
      'RASTREADA'
    )
  })

  test('distribuída sem link = fallback', () => {
    for (const link of [null, undefined, {}, { criadoEm: null }]) {
      assert.equal(
        derivarEstadoDaPublicacaoPersistida({ estado: 'DISTRIBUIDA', distribuidaEm: t0, link }),
        'NAO_RASTREADA_COM_FALLBACK'
      )
    }
  })

  test('DISTRIBUIDA + NAO_RASTREADA_COM_FALLBACK é combinação VÁLIDA', () => {
    // Distribuição e rastreamento são eixos independentes.
    const estado = derivarEstadoDaPublicacaoPersistida({
      estado: 'DISTRIBUIDA',
      distribuidaEm: t0,
      link: null,
    })
    assert.equal(estado, 'NAO_RASTREADA_COM_FALLBACK')
    assert.notEqual(estado, 'NAO_PUBLICADA')
  })

  test('qualquer estado que não seja DISTRIBUIDA = NAO_PUBLICADA', () => {
    for (const e of ESTADOS_DA_PUBLICACAO) {
      if (e === 'DISTRIBUIDA') continue
      assert.equal(
        derivarEstadoDaPublicacaoPersistida({ estado: e, distribuidaEm: t0, link: { criadoEm: antes } }),
        'NAO_PUBLICADA',
        `${e} não pode habilitar medição`
      )
    }
  })

  test('DISTRIBUIDA sem instante de distribuição é contradição, não medição', () => {
    for (const d of [null, undefined, 'nao-e-data', new Date('x')]) {
      assert.equal(
        derivarEstadoDaPublicacaoPersistida({ estado: 'DISTRIBUIDA', distribuidaEm: d, link: { criadoEm: antes } }),
        'NAO_PUBLICADA'
      )
    }
  })

  test('data ilegível no link nunca vira RASTREADA', () => {
    for (const c of ['', '   ', 'ontem', new Date('x')]) {
      assert.equal(
        derivarEstadoDaPublicacaoPersistida({ estado: 'DISTRIBUIDA', distribuidaEm: t0, link: { criadoEm: c } }),
        'NAO_RASTREADA_COM_FALLBACK'
      )
    }
  })

  test('aceita ISO string, que é como o JSON entrega', () => {
    assert.equal(
      derivarEstadoDaPublicacaoPersistida({
        estado: 'DISTRIBUIDA',
        distribuidaEm: t0.toISOString(),
        link: { criadoEm: antes.toISOString() },
      }),
      'RASTREADA'
    )
  })

  test('nada é persistido: o schema não tem coluna de estado de rastreamento', () => {
    const m = SCHEMA_CRU.match(/model Publicacao \{[\s\S]*?\n\}/)
    assert.ok(m)
    assert.ok(!/rastread/i.test(m[0]), 'o estado é derivado, não guardado')
    assert.ok(!/RASTREADA/.test(SQL))
  })
})
