/**
 * P2.28 — HEALTH CHECK OPERACIONAL (administração). Responde "SISTEMA SAUDÁVEL" ou "ATENÇÃO NECESSÁRIA" com
 * indicadores que mudam decisão — não é dashboard decorativo. Só LÊ (as estruturas canônicas: DomainEvent,
 * AutomationJob, PublicacaoAssistida, ImportacaoCreatorCenter, ExecucaoDoProcessador, _prisma_migrations).
 * Cada indicador em atenção vem com a frase acionável do que fazer.
 */
import { prisma } from './prisma'

const MIN = 60_000

export interface Indicador { chave: string; rotulo: string; valor: number | string | null; ok: boolean; texto: string; link?: string }
export interface SaudeOperacional {
  geradoEm: string
  veredito: 'SISTEMA SAUDÁVEL' | 'ATENÇÃO NECESSÁRIA'
  indicadores: Indicador[]
  agendamentos: { rotina: string; ligada: boolean; detalhe: string }[]
}

/** FUNÇÃO PURA: veredito a partir dos indicadores. */
export function vereditoDaSaude(indicadores: Pick<Indicador, 'ok'>[]): SaudeOperacional['veredito'] {
  return indicadores.every((i) => i.ok) ? 'SISTEMA SAUDÁVEL' : 'ATENÇÃO NECESSÁRIA'
}

const quando = (d: Date | null | undefined, agora: Date) => {
  if (!d) return 'nunca'
  const m = Math.round((agora.getTime() - d.getTime()) / MIN)
  return m < 120 ? `há ${m} min` : m < 2880 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`
}

export async function saudeOperacional(workspaceId: string, agora: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<SaudeOperacional> {
  const { ultimaReconciliacao, PUBLICANDO_SEM_REFERENCIA_MIN, IMPORTACAO_ABANDONADA_MIN, EVENTO_PRESO_MIN } = await import('./reconciliacao')
  const [eventosPresos, eventosFalhos, jobsFalhos, jobsIncertos, incertas, publicandoVelhas, importacoesAbertas, ultimaExec, ultimaComTrabalho, rec, migracoes] = await Promise.all([
    prisma.domainEvent.count({ where: { workspaceId, OR: [{ estadoProcessamento: 'PROCESSANDO', processandoAte: { lt: new Date(agora.getTime() - EVENTO_PRESO_MIN * MIN) } }, { estadoProcessamento: 'RETRY', proximaTentativaEm: { lt: new Date(agora.getTime() - 60 * MIN) } }] } }),
    prisma.domainEvent.count({ where: { workspaceId, estadoProcessamento: 'FALHOU' } }),
    prisma.automationJob.count({ where: { workspaceId, estado: 'FAILED_FINAL', updatedAt: { gt: new Date(agora.getTime() - 7 * 1440 * MIN) } } }),
    prisma.automationJob.count({ where: { workspaceId, estado: 'WAITING', motivoHumano: 'PROVIDER_OUTCOME_UNCONFIRMED' } }),
    prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: 'FALHOU', erro: { startsWith: 'ENVIO INCERTO' } } }),
    prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: 'PUBLICANDO', updatedAt: { lt: new Date(agora.getTime() - PUBLICANDO_SEM_REFERENCIA_MIN * MIN) } } }),
    prisma.importacaoCreatorCenter.count({ where: { workspaceId, concluida: false, importadoEm: { lt: new Date(agora.getTime() - IMPORTACAO_ABANDONADA_MIN * MIN) } } }),
    prisma.execucaoDoProcessador.findFirst({ where: { workspaceId, tipo: 'EXECUCAO' }, orderBy: { iniciadoEm: 'desc' }, select: { iniciadoEm: true } }),
    prisma.execucaoDoProcessador.findFirst({ where: { workspaceId, tipo: 'EXECUCAO', processados: { gt: 0 } }, orderBy: { iniciadoEm: 'desc' }, select: { iniciadoEm: true, processados: true } }),
    ultimaReconciliacao(workspaceId),
    prisma.$queryRaw<{ total: number; falhas: number; ultima: string | null; ultimaEm: Date | null }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL)::int AS falhas,
             (array_agg("migration_name" ORDER BY "started_at" DESC))[1] AS ultima,
             max("finished_at") AS "ultimaEm"
      FROM "_prisma_migrations"`.catch(() => null),
  ])
  const pendentesDaReconciliacao = rec ? rec.achados.filter((a) => a.desfecho !== 'CORRIGIDO').length : 0
  const recVelha = !rec || agora.getTime() - (rec.terminadoEm ?? rec.em).getTime() > 6 * 60 * MIN
  const m = migracoes?.[0] ?? null
  const indicadores: Indicador[] = [
    { chave: 'eventosPresos', rotulo: 'Eventos presos', valor: eventosPresos, ok: eventosPresos === 0, texto: eventosPresos ? `${eventosPresos} evento(s) parados há mais de ${EVENTO_PRESO_MIN} min — confira se o processador agendado está ligado.` : 'Nenhum evento parado.', link: '/admin/eventos' },
    { chave: 'eventosFalhos', rotulo: 'Eventos com falha', valor: eventosFalhos, ok: eventosFalhos === 0, texto: eventosFalhos ? `${eventosFalhos} evento(s) falharam depois de todas as tentativas — veja o erro e reprocesse em Eventos.` : 'Nenhum evento falho.', link: '/admin/eventos' },
    { chave: 'jobsFalhos', rotulo: 'Tarefas falhas (7 dias)', valor: jobsFalhos + jobsIncertos, ok: jobsFalhos + jobsIncertos === 0, texto: jobsFalhos + jobsIncertos ? `${jobsFalhos} tarefa(s) falharam de vez e ${jobsIncertos} ficaram sem confirmação do provedor.` : 'Nenhuma tarefa falha.' },
    { chave: 'publicacoesIncertas', rotulo: 'Publicações incertas', valor: incertas + publicandoVelhas, ok: incertas + publicandoVelhas === 0, texto: incertas + publicandoVelhas ? `${incertas} publicação(ões) em estado incerto e ${publicandoVelhas} "publicando" há mais de ${PUBLICANDO_SEM_REFERENCIA_MIN} min — confirme no TikTok antes de tentar de novo.` : 'Nenhuma publicação incerta.', link: '/precisa-de-voce' },
    { chave: 'importacoesIncompletas', rotulo: 'Importações incompletas', valor: importacoesAbertas, ok: importacoesAbertas === 0, texto: importacoesAbertas ? `${importacoesAbertas} importação(ões) começaram e não terminaram — envie o mesmo arquivo de novo (nada duplica).` : 'Nenhuma importação pela metade.', link: '/vendas-comissoes' },
    { chave: 'reconciliacao', rotulo: 'Reconciliação', valor: pendentesDaReconciliacao, ok: !recVelha && pendentesDaReconciliacao === 0 && !(rec?.falhas.length),
      texto: !rec ? 'A reconciliação ainda não rodou nesta conta.' : rec.falhas.length ? `A última reconciliação teve ${rec.falhas.length} verificação(ões) com erro: ${rec.falhas[0]}` : recVelha ? `A última reconciliação foi ${quando(rec.terminadoEm ?? rec.em, agora)} — a rotina agendada está ligada?` : pendentesDaReconciliacao ? `${pendentesDaReconciliacao} ponto(s) que a reconciliação não pôde resolver sozinha (${quando(rec.em, agora)}).` : `Tudo conferido ${quando(rec.em, agora)}.` },
    { chave: 'migrations', rotulo: 'Migrations do banco', valor: m ? m.total : null, ok: !!m && m.falhas === 0, texto: !m ? 'Não consegui ler o histórico de migrations.' : m.falhas ? `${m.falhas} migration(s) com falha ou revertida(s) — não aplique mais nada antes de resolver.` : `${m.total} aplicadas; a última: ${m.ultima} (${quando(m.ultimaEm, agora)}).` },
    { chave: 'ultimoProcessamento', rotulo: 'Último processamento de eventos', valor: ultimaComTrabalho?.iniciadoEm.toISOString() ?? null, ok: true, texto: ultimaExec ? `Última execução ${quando(ultimaExec.iniciadoEm, agora)}; último lote com trabalho ${quando(ultimaComTrabalho?.iniciadoEm, agora)}${ultimaComTrabalho ? ` (${ultimaComTrabalho.processados} evento(s))` : ''}.` : 'O processador ainda não rodou nesta conta.' },
  ]
  const agendamentos = [
    { rotina: 'processar-eventos', ligada: env.PROCESSADOR_DE_EVENTOS_AGENDADO === 'true', detalhe: 'PROCESSADOR_DE_EVENTOS_AGENDADO' },
    { rotina: 'reconciliar', ligada: env.RECONCILIACAO_AGENDADA === 'true', detalhe: 'RECONCILIACAO_AGENDADA' },
    { rotina: 'sincronizar-metas-tiktok', ligada: env.TIKTOK_MISSOES_SYNC_AGENDADA === 'true', detalhe: 'TIKTOK_MISSOES_SYNC_AGENDADA' },
    { rotina: 'executar-fila', ligada: !!env.CRON_SECRET, detalhe: 'CRON_SECRET configurado' },
  ]
  return { geradoEm: agora.toISOString(), veredito: vereditoDaSaude(indicadores), indicadores, agendamentos }
}
