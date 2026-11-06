import type { Metadata } from 'next'
import Link from 'next/link'
import { dadosInstitucionais, RAZAO_SOCIAL, NOME_DO_PRODUTO, VERSAO_DOS_TEXTOS } from '@/lib/institucional'

export const metadata: Metadata = {
  title: `Termos de Uso — ${NOME_DO_PRODUTO} | ${RAZAO_SOCIAL}`,
}

/**
 * Versão final pré-publicação (02/10/2026), aguardando aprovação da titular.
 *
 * Nenhuma cláusula promete funcionalidade que não existe: encerramento é por
 * solicitação, integrações priorizam API oficial (e o fluxo não oficial da
 * Shopee está bloqueado), filtros automáticos não substituem revisão.
 */
export default function PaginaTermos() {
  const e = dadosInstitucionais()
  const h2 = 'text-xl font-semibold text-accent'
  const lista = 'list-disc pl-6 space-y-1 text-white/80'
  const p = 'text-white/80'

  return (
    <article className="space-y-8 leading-relaxed">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Termos de Uso</h1>
        <p className="text-white/60 text-sm">Versão de {VERSAO_DOS_TEXTOS}</p>
        <p className={p}>
          Estes termos regem o uso do <strong>{e.produto}</strong>, plataforma da{' '}
          <strong>{e.razaoSocial}</strong>{e.cnpj ? <>, CNPJ {e.cnpj}</> : null}. Ao criar uma conta, a
          usuária declara que leu e concorda com estes termos e com a{' '}
          <Link className="underline" href="/privacidade">Política de Privacidade</Link>.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className={h2}>1. Natureza e finalidade do serviço</h2>
        <p className={p}>
          O {e.produto} é uma plataforma de software para automação de comércio digital. Ele apoia a gestão de
          produtos e programas de afiliados, a análise de oportunidades, a preparação de conteúdo de divulgação, a
          integração com plataformas de terceiros e o rastreamento de cliques, vendas e comissões. O {e.produto} é uma
          ferramenta: as decisões comerciais e o conteúdo publicado são da usuária.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>2. Conta e segurança</h2>
        <ul className={lista}>
          <li>A usuária deve fornecer dados verdadeiros e mantê-los atualizados.</li>
          <li>A usuária é responsável pela guarda da senha e pelas atividades realizadas na sua conta, e deve comunicar pelo canal da seção 17 qualquer uso não autorizado.</li>
          <li>Cada conta corresponde a um negócio; os dados de uma conta não são acessíveis por outra.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>3. Integrações e dependência de terceiros</h2>
        <ul className={lista}>
          <li>O {e.produto} utiliza integrações técnicas com plataformas e provedores de terceiros, priorizando APIs oficiais quando disponíveis e autorizadas. Não utiliza automação de navegador. Integrações que dependam de fluxo não oficial ficam bloqueadas até revisão.</li>
          <li>As integrações dependem de autorização da titular nas próprias plataformas, que pode ser revogada a qualquer momento nessas plataformas.</li>
          <li>O uso de cada plataforma continua sujeito aos termos e às regras dela, que a usuária deve cumprir.</li>
          <li>As plataformas de terceiros podem limitar, suspender ou alterar suas APIs, programas e regras independentemente da {e.razaoSocial}. Isso pode afetar funcionalidades do {e.produto}.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>4. Conteúdo da usuária e responsabilidade</h2>
        <ul className={lista}>
          <li>A usuária é responsável pelo conteúdo que envia, aprova e publica, inclusive legendas, alegações sobre produtos, preços e mídia.</li>
          <li>A usuária declara ter os direitos necessários sobre a mídia que envia — inclusive imagem e voz de pessoas que nela apareçam — e sobre o conteúdo de terceiros que utilizar.</li>
          <li>O {e.produto} registra a declaração de origem e de direito de uso de cada mídia, e bloqueia a publicação de mídia sem direito comprovado. Essa verificação apoia a usuária, mas não substitui a responsabilidade dela pelos direitos sobre a mídia nem a dispensa de cumprir a lei.</li>
          <li>É proibido usar a plataforma para conteúdo enganoso, ilícito, que viole direitos de terceiros ou as regras das plataformas e dos programas de afiliados.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>5. Propriedade intelectual</h2>
        <ul className={lista}>
          <li><strong>Plataforma:</strong> o software, o código, a interface, a marca {e.produto} e a tecnologia da plataforma pertencem à {e.razaoSocial} ou a quem a licenciou. Estes termos não transferem esses direitos à usuária; concedem apenas o direito de usar o serviço enquanto a conta estiver ativa.</li>
          <li><strong>Dados e conteúdo da usuária:</strong> continuam sendo da usuária, ou de quem ela tiver obtido os direitos. Enviá-los à plataforma não transfere propriedade à {e.razaoSocial}.</li>
          <li><strong>Conteúdo de terceiros:</strong> imagens, textos, marcas e informações de produtos, vendedores, plataformas e programas de afiliados pertencem aos respectivos titulares. A {e.razaoSocial} não concede direito sobre eles.</li>
          <li><strong>Conteúdo gerado ou transformado pela plataforma:</strong> legendas, roteiros e peças que a plataforma prepara a partir do material da usuária ficam à disposição dela para uso no serviço e nas plataformas que ela conectar. Esse conteúdo não amplia os direitos que existiam sobre o material de origem: se a mídia de origem pertence a terceiro, o resultado continua sujeito aos direitos desse terceiro.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>6. Licença concedida pela usuária</h2>
        <p className={p}>
          A usuária concede à {e.razaoSocial} licença não exclusiva, gratuita e limitada para armazenar, processar,
          adaptar e publicar o material que enviar, somente na medida necessária para executar as ações que ela
          comandar no {e.produto} e enquanto a conta estiver ativa. A licença termina com o encerramento da conta,
          ressalvado o que já tiver sido publicado a pedido dela e o que precisar ser mantido por obrigação legal,
          conforme a Política de Privacidade.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>7. Conteúdo gerado ou auxiliado por automação e IA</h2>
        <ul className={lista}>
          <li>O {e.produto} usa automações e pode usar inteligência artificial para preparar e analisar conteúdo. Conteúdo gerado ou auxiliado por esses recursos pode conter imprecisões.</li>
          <li>A plataforma aplica filtros automáticos — por exemplo, para retirar alegações sem comprovação e para exigir o aviso de conteúdo comercial —, mas eles não substituem a revisão da usuária antes de publicar.</li>
          <li>Recursos de IA de terceiros só são usados quando habilitados, nos termos da Política de Privacidade.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>8. Afiliados e divulgação comercial</h2>
        <ul className={lista}>
          <li>A usuária é responsável por cumprir os termos de cada programa de afiliados de que participa.</li>
          <li>O conteúdo de divulgação de afiliados deve identificar a natureza comercial. As legendas preparadas pela plataforma incluem esse aviso, e ele é verificado antes de uma publicação.</li>
          <li>Comissões são pagas pelos programas de afiliados, segundo as regras deles. A {e.razaoSocial} não é parte nessa relação e não paga comissões.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>9. Ausência de garantia de resultados</h2>
        <p className={p}>
          A plataforma organiza, mede e automatiza; ela não garante vendas, comissões, alcance nem aprovação de
          conteúdo pelas plataformas. Preços, comissões e disponibilidade exibidos vêm das fontes informadas e podem
          mudar nas plataformas de origem.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>10. Disponibilidade e alterações do serviço</h2>
        <p className={p}>
          O serviço pode passar por interrupções, manutenções e falhas, inclusive de fornecedores de infraestrutura e
          de plataformas integradas. Funcionalidades podem ser criadas, alteradas ou descontinuadas. Alterações
          relevantes serão informadas à usuária.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>11. Suspensão</h2>
        <p className={p}>
          A {e.razaoSocial} pode suspender, total ou parcialmente, o acesso de contas que violem estes termos, a lei
          ou as regras das plataformas integradas, que representem risco à segurança do serviço ou de terceiros, ou
          quando houver determinação legal ou judicial. Sempre que possível, a usuária será informada do motivo.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>12. Encerramento</h2>
        <p className={p}>
          A usuária pode solicitar o encerramento da conta pelo canal da seção 17. A exclusão dos dados é processada
          conforme procedimento interno e as obrigações legais aplicáveis, nos termos da Política de Privacidade.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>13. Limitação de responsabilidade</h2>
        <p className={p}>
          Na extensão permitida pela legislação aplicável, a {e.razaoSocial} não responde por: atos, falhas ou
          alterações das plataformas e dos programas de afiliados de terceiros; conteúdo enviado, aprovado ou
          publicado pela usuária; e resultados comerciais esperados e não obtidos. Esta cláusula não afasta
          responsabilidades que a lei não permite excluir, nem os direitos da usuária como consumidora, quando a
          relação for de consumo.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>14. Privacidade</h2>
        <p className={p}>
          O tratamento de dados pessoais segue a <Link className="underline" href="/privacidade">Política de Privacidade</Link>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>15. Alterações destes termos</h2>
        <p className={p}>
          Estes termos podem ser atualizados, com a data da versão indicada no topo. Alterações relevantes serão
          informadas à usuária.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>16. Legislação e foro</h2>
        <p className={p}>
          Aplica-se a legislação brasileira. Eventuais controvérsias serão resolvidas no foro competente nos termos da
          lei. Quando a relação for de consumo, a consumidora poderá propor a ação no foro do seu domicílio.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>17. Contato</h2>
        <p className={p}>
          Dúvidas, solicitações e comunicações sobre estes termos:{' '}
          <a className="underline" href={`mailto:${e.contato}`}>{e.contato}</a>.
        </p>
      </section>
    </article>
  )
}
