/**
 * P2.17.17 — Registra no banco de TESTE os fatos CONFIRMADOS pela titular em 12/10/2026:
 *   - pagamento/fiscal da conta de afiliada TikTok Shop concluído (confirmado pela titular, sem API);
 *   - 4 amostras já pedidas no app, todas PENDENTES DE APROVAÇÃO;
 *   - o que ela VIU no app (comissão estimada, tipo de amostra) como snapshot manual.
 * Idempotente (rodar de novo não duplica). Não chama TikTok, não pede amostra, não inventa data
 * (data da solicitação desconhecida → null). Uso: node --env-file=<teste> tsx scripts/teste/p21717-registrar-amostras.ts <workspaceId>
 */
import { prisma } from '../../lib/prisma'
import { registrarAmostra } from '../../lib/amostras'
import { chaveDeProduto, registrarObservacao } from '../../lib/observacoes-de-mercado'

const INFORMADO_EM = '12/10/2026'
const AMOSTRAS = [
  { nomeProduto: 'Hidrabene Protetor Solar Facial FPS 70', categoria: 'Beleza', tipo: 'GRATIS', comissao: 5.54, papeis: ['PRODUTO_AFILIADO'], campanha: null, motivo: 'Forte evidência de vendas no TikTok Shop (relatada pela titular) + comissão vista R$ 5,54.', obs: 'Titular relatou forte evidência de vendas no TikTok Shop; número e posição não informados (não registrados).' },
  { nomeProduto: 'Kit Depilador Elétrico 4 em 1', categoria: 'Beleza', tipo: 'GRATIS', comissao: 3.04, papeis: ['PRODUTO_AFILIADO'], campanha: null, motivo: 'Produto visual e fácil de demonstrar + comissão vista R$ 3,04.', obs: null },
  { nomeProduto: 'Suporte de cabeça e peitoral para celular', categoria: 'Eletrônicos', tipo: 'GRATIS', comissao: null, papeis: ['PRODUTO_AFILIADO', 'EQUIPAMENTO_OPERACIONAL'], campanha: null, motivo: 'Produto afiliado e equipamento de produção (vídeos POV mãos livres).', obs: null },
  { nomeProduto: 'Capa de almofadas de Natal', categoria: 'Casa e Decoração', tipo: null, comissao: 2.84, papeis: ['PRODUTO_AFILIADO'], campanha: 'natal-2026', motivo: 'Sazonal Natal 2026, baixo ticket, presente/decoração + comissão vista ~R$ 2,84.', obs: 'Comissão informada como aproximada (~R$ 2,84).' },
] as const

async function main() {
  const ws = process.argv[2]
  if (!ws) throw new Error('informe o workspaceId')
  if (!(process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')) throw new Error('só TESTE')
  if (!(await prisma.workspace.findUnique({ where: { id: ws }, select: { id: true } }))) throw new Error('workspace não encontrado')

  const nota = `Conta de afiliada TikTok Shop: pagamento/fiscal CONFIRMADO PELA TITULAR em ${INFORMADO_EM} (sem confirmação por API).`
  const programa = await prisma.affiliateProgram.upsert({
    where: { workspaceId_platform: { workspaceId: ws, platform: 'tiktok-shop' } },
    create: { workspaceId: ws, platform: 'tiktok-shop', status: 'ACTIVE', operationMode: 'MANUAL', integrationStatus: 'NOT_AVAILABLE', notes: nota },
    update: { status: 'ACTIVE', notes: nota },
  })
  console.log('programa', programa.platform, programa.status)

  for (const a of AMOSTRAS) {
    const r = await registrarAmostra({
      workspaceId: ws, userId: null,
      dados: { nomeProduto: a.nomeProduto, categoria: a.categoria, tipo: a.tipo, estado: 'PENDENTE_APROVACAO', papeis: [...a.papeis], comissaoObservada: a.comissao, comissaoFonte: a.comissao !== null ? 'TIKTOK_APP_MANUAL' : null, solicitadaEm: null, campanha: a.campanha, motivo: a.motivo, observacao: `Informado pela titular em ${INFORMADO_EM}: pedido feito no app, pendente de aprovação do vendedor.${a.obs ? ` ${a.obs}` : ''}` },
    })
    console.log('amostra', a.nomeProduto, r.criada ? 'criada' : 'já existia', r.amostra.estado)
    const chave = chaveDeProduto({ nome: a.nomeProduto })
    const ja = await prisma.observacaoDeMercado.count({ where: { workspaceId: ws, chave, fonte: 'TIKTOK_APP_MANUAL' } })
    if (!ja && (a.comissao !== null || a.tipo)) {
      await registrarObservacao({ workspaceId: ws, userId: null, dados: { nomeProduto: a.nomeProduto, candidatoId: r.amostra.candidatoId, fonte: 'TIKTOK_APP_MANUAL', comissaoExibida: a.comissao, tipoDeAmostra: a.tipo, observacao: `Visto no app pela titular; informado em ${INFORMADO_EM}.${a.obs ? ` ${a.obs}` : ''}` } })
      console.log('  observação registrada')
    }
  }
}
main().finally(() => prisma.$disconnect())
