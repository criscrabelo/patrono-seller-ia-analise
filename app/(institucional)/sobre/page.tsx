import type { Metadata } from 'next'
import Link from 'next/link'
import { dadosInstitucionais, RAZAO_SOCIAL, NOME_DO_PRODUTO } from '@/lib/institucional'

export const metadata: Metadata = {
  title: `Sobre — ${NOME_DO_PRODUTO} | ${RAZAO_SOCIAL}`,
  description: `${NOME_DO_PRODUTO} é uma plataforma de automação de comércio digital da ${RAZAO_SOCIAL}.`,
}

/** Página institucional PÚBLICA. Sem login, sem dado de usuária. */
export default function PaginaSobre() {
  const empresa = dadosInstitucionais()

  return (
    <article className="space-y-8 leading-relaxed">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold">Sobre o {empresa.produto}</h1>
        <p className="text-white/80">
          O <strong>{empresa.produto}</strong> é um produto e plataforma da{' '}
          <strong>{empresa.razaoSocial}</strong>.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-accent">A empresa</h2>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-white/80">
          <dt className="text-white/60">Nome empresarial</dt>
          <dd>{empresa.razaoSocial}</dd>
          {empresa.cnpj && (
            <>
              <dt className="text-white/60">CNPJ</dt>
              <dd>{empresa.cnpj}</dd>
            </>
          )}
          <dt className="text-white/60">Produto</dt>
          <dd>{empresa.produto}</dd>
          <dt className="text-white/60">Contato</dt>
          <dd>
            <a className="underline" href={`mailto:${empresa.contato}`}>{empresa.contato}</a>
          </dd>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-accent">O que é o {empresa.produto}</h2>
        <p className="text-white/80">
          O {empresa.produto} é uma plataforma de software para criadoras de conteúdo e empreendedoras do
          comércio digital. Ela organiza, em um só lugar, o trabalho de encontrar produtos com potencial de
          venda, preparar conteúdo de divulgação, publicar pelos canais oficiais das plataformas e medir o
          resultado em cliques, vendas e comissões.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-accent">Finalidade</h2>
        <ul className="list-disc pl-6 space-y-1 text-white/80">
          <li><strong>Automação de comércio digital</strong> — rotinas recorrentes executadas pela plataforma, com aprovação humana onde a regra exige.</li>
          <li><strong>Marketing de afiliados</strong> — gestão de produtos e programas de afiliados, com aviso de conteúdo comercial nas divulgações preparadas pela plataforma.</li>
          <li><strong>Análise de oportunidades</strong> — priorização de produtos a partir de dados reais do catálogo e do desempenho anterior.</li>
          <li><strong>Conteúdo</strong> — preparação de legendas e peças de divulgação, respeitando os direitos de uso de cada mídia.</li>
          <li><strong>Integrações</strong> — conexão com plataformas e provedores de terceiros, priorizando APIs oficiais quando disponíveis e autorizadas, e sempre com autorização da titular da conta.</li>
          <li><strong>Rastreamento de vendas e comissões</strong> — links rastreados, registro de cliques e conciliação de vendas e comissões.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-accent">Como operamos</h2>
        <ul className="list-disc pl-6 space-y-1 text-white/80">
          <li>O {empresa.produto} utiliza integrações técnicas com plataformas e provedores de terceiros, priorizando APIs oficiais quando disponíveis e autorizadas. Não utiliza automação de navegador. Integrações que dependam de fluxo não oficial ficam bloqueadas até revisão.</li>
          <li>Credenciais e tokens de acesso ficam somente nos servidores da plataforma e nunca são enviados ao navegador.</li>
          <li>As legendas preparadas pela plataforma incluem aviso de conteúdo comercial, e esse aviso é verificado antes de uma publicação.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-accent">Documentos</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><Link className="underline" href="/privacidade">Política de Privacidade</Link></li>
          <li><Link className="underline" href="/termos">Termos de Uso</Link></li>
        </ul>
      </section>
    </article>
  )
}
