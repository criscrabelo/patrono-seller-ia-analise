import type { Metadata } from 'next'
import Link from 'next/link'
import { dadosInstitucionais, RAZAO_SOCIAL, NOME_DO_PRODUTO } from '@/lib/institucional'

export const metadata: Metadata = {
  title: `Política de Privacidade — ${NOME_DO_PRODUTO} | ${RAZAO_SOCIAL}`,
}

/**
 * Versão para a hospedagem Netlify (P2.8), aprovada em 03/10/2026. Vigora
 * com o go-live: a data vem de `PATRONO_VERSAO_DA_POLITICA`, e o parágrafo
 * de transição da Vercel (por até 14 dias) de
 * `PATRONO_TRANSICAO_DE_HOSPEDAGEM` — ver lib/institucional.ts.
 *
 * Cada afirmação descreve o que o código e a infraestrutura fazem. O que não
 * pôde ser comprovado foi redigido de forma geral, sem inventar país,
 * mecanismo ou prazo. P2.14.2: a seção 6 nomeia o mecanismo da hospedagem
 * (art. 33, IX c/c art. 7º, V), restrito aos fluxos contratuais da usuária,
 * conforme REGISTRO-INTERNO-TRANSFERENCIA-NETLIFY.md; WhatsApp e avatar
 * ficam fora das funções no exterior (lib/transferencia-internacional.ts,
 * upload direto do avatar). Os testes `rodada50`, `rodada54` e `rodada58`
 * conferem o texto contra o código.
 */
export default function PaginaPrivacidade() {
  const e = dadosInstitucionais()
  const h2 = 'text-xl font-semibold text-accent'
  const h3 = 'font-semibold text-white'
  const lista = 'list-disc pl-6 space-y-1 text-white/80'
  const p = 'text-white/80'

  return (
    <article className="space-y-8 leading-relaxed">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Política de Privacidade</h1>
        <p className="text-white/60 text-sm">
          {e.versaoDaPolitica ? <>Versão de {e.versaoDaPolitica}</> : <>Versão a vigorar com a mudança de hospedagem do serviço</>}
        </p>
        <p className={p}>
          Esta política explica como a <strong>{e.razaoSocial}</strong>
          {e.cnpj ? <>, inscrita no CNPJ {e.cnpj},</> : null} controladora dos dados pessoais tratados no{' '}
          <strong>{e.produto}</strong>, coleta, usa, armazena, compartilha e protege dados pessoais, nos termos
          da Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD). Ela vale para o site{' '}
          <strong>{e.dominio}</strong> e para o serviço {e.produto}.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className={h2}>1. Dados que tratamos</h2>
        <ul className={lista}>
          <li><strong>Conta:</strong> nome, e-mail e senha. A senha é armazenada apenas como hash (bcrypt), nunca em texto.</li>
          <li><strong>Dados do negócio:</strong> produtos, conteúdos, links de divulgação, programas de afiliados, vendas e comissões que a usuária cadastra ou importa.</li>
          <li><strong>Integrações:</strong> identificadores da conta conectada e as credenciais e tokens de acesso concedidos pela usuária nas plataformas conectadas. Ficam somente no servidor e nunca são enviados ao navegador.</li>
          <li><strong>TikTok (quando a usuária conectar a conta):</strong> o identificador da conta e as informações básicas do perfil concedidas na autorização (escopo user.info.basic), os tokens de acesso, os vídeos que ela aprovar para envio (escopo video.upload) e, dos vídeos publicados pelo {e.produto}, o identificador, o endereço e as estatísticas públicas, como visualizações (escopo video.list), usadas só para medir o resultado de cada publicação. O {e.produto} não lê mensagens, comentários, seguidores nem outros vídeos da conta.</li>
          <li><strong>Cliques em links rastreados:</strong> o link acessado, a plataforma e o endereço de origem informado pelo navegador (referer). O {e.produto} não grava em seu banco de dados o endereço IP de quem clica.</li>
          <li><strong>Mídia enviada:</strong> imagens e vídeos enviados pela usuária, com a declaração de origem e de direito de uso de cada arquivo.</li>
          <li><strong>Imagem e voz da própria titular (recurso opcional de avatar):</strong> fotos, vídeo de referência e áudio de referência de voz, tratados somente com o consentimento descrito na seção 3.</li>
          <li><strong>Números de telefone de terceiros (recurso opcional de envio por WhatsApp):</strong> números que a usuária insere para enviar mensagens. A lista de contatos salvos fica no navegador da própria usuária (seção 7). Quando ela comanda um envio, os números, a mensagem e o resultado de cada envio ficam registrados no servidor, para que nenhuma pessoa receba a mesma mensagem duas vezes e para que a usuária possa conferir o que foi enviado, pelo tempo necessário a essa finalidade e ao cumprimento das obrigações legais. Em relação a esses contatos, cabe à usuária ter base legal para contatá-los.</li>
          <li><strong>Tarefas em segundo plano:</strong> ao pedir uma tarefa demorada — publicação, legenda ou envio de mensagens —, os dados necessários à tarefa e o seu andamento ficam registrados no servidor pelo tempo necessário à execução, à conferência pela usuária e ao cumprimento das obrigações legais.</li>
          <li><strong>Registro de auditoria:</strong> ações relevantes na conta (por exemplo, integração conectada, revogação de consentimento, catálogo sincronizado), sem senhas nem tokens. A concessão e a revogação de cada consentimento também ficam registradas, com data.</li>
        </ul>
        <p className={p}>
          Os provedores de infraestrutura (seção 5) podem registrar, em seus próprios registros técnicos,
          metadados das requisições, como endereço IP e navegador, conforme os termos e as políticas de cada um.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>2. Para que usamos</h2>
        <ul className={lista}>
          <li>Prestar o serviço contratado: organizar produtos, preparar e publicar conteúdo, rastrear cliques, vendas e comissões.</li>
          <li>Executar as integrações que a usuária conectar e autorizar.</li>
          <li>Executar em segundo plano as tarefas que a usuária solicitar.</li>
          <li>Proteger a conta, prevenir fraudes e cumprir obrigações legais.</li>
          <li>Enviar mensagens operacionais, como a recuperação de senha.</li>
        </ul>
        <p className={p}>Não vendemos dados pessoais.</p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>3. Bases legais</h2>
        <ul className={lista}>
          <li><strong>Execução de contrato</strong> (art. 7º, V): dados de conta, do negócio, de integrações, de cliques e das tarefas solicitadas, necessários para prestar o serviço.</li>
          <li><strong>Cumprimento de obrigação legal ou regulatória</strong> (art. 7º, II): manutenção dos registros exigidos por lei.</li>
          <li><strong>Exercício regular de direitos</strong> (art. 7º, VI): manutenção de registros de auditoria e de consentimento.</li>
          <li><strong>Legítimo interesse</strong> (art. 7º, IX): segurança da conta e prevenção a fraudes.</li>
          <li><strong>Consentimento</strong> (art. 7º, I): imagem e voz da titular no recurso de avatar. O recurso só funciona com esse consentimento, que é específico por finalidade, registrado e revogável a qualquer momento.</li>
        </ul>
        <p className={p}>
          Imagem e voz são tratadas como dados pessoais. O {e.produto} <strong>não realiza identificação nem
          verificação biométrica</strong> da titular: não há reconhecimento facial, nem extração de características
          biométricas para identificar uma pessoa. A voz de referência é usada para sintetizar a narração, não para
          identificar quem fala. Se algum recurso futuro tratar dado biométrico, esta política será atualizada e o
          tratamento observará o art. 11 da LGPD antes de começar.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className={h2}>4. Inteligência artificial e automações</h2>
        <p className={p}>
          O {e.produto} usa automações e pode usar sistemas de inteligência artificial para apoiar tarefas como
          análise e priorização de oportunidades de produtos, preparação de legendas e roteiros, classificação de
          conteúdo (por exemplo, identificar alegações sem comprovação) e otimização de rotinas.
        </p>
        <ul className={lista}>
          <li>O uso de automação ou de IA não autoriza o tratamento de dados para finalidade incompatível com as descritas nesta política.</li>
          <li><strong>Provedores de IA e de processamento de mídia:</strong> serviços externos de inteligência artificial e de processamento de mídia só recebem dados quando a funcionalidade correspondente estiver habilitada e somente o que for tecnicamente necessário para a tarefa. Hoje esses serviços ficam desligados por padrão, e a geração de conteúdo usa um caminho próprio, sem serviços externos de IA. Recursos de IA oferecidos pela própria hospedagem não são usados.</li>
          <li><strong>Voz sintetizada:</strong> quando a titular ativa o recurso de avatar, a síntese de voz é executada em um computador de processamento indicado por ela, e não em um serviço de IA de terceiros.</li>
          <li><strong>Decisões e revisão humana:</strong> as recomendações automáticas do {e.produto} não publicam nada sozinhas. A publicação passa por verificações e pela autorização da usuária. Quando o resultado de uma publicação ou de um envio não puder ser confirmado pela plataforma, o {e.produto} não o repete automaticamente: a situação fica sinalizada para a usuária conferir. Quando houver decisão tomada unicamente com base em tratamento automatizado que afete interesses da titular, ela poderá solicitar a revisão (art. 20 da LGPD) pelo canal da seção 11.</li>
          <li>Mídia e conteúdo da usuária <strong>não se tornam propriedade</strong> da {e.razaoSocial} pelo simples processamento por automações ou IA (seção 9).</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>5. Com quem compartilhamos (operadores e outros destinatários)</h2>
        <ul className={lista}>
          <li><strong>Hospedagem da aplicação</strong> (Netlify): recebe e processa todas as requisições ao serviço e executa em segundo plano as tarefas demoradas que a usuária solicitar.</li>
          <li><strong>Banco de dados e armazenamento de arquivos</strong> (Supabase): guarda os dados da conta, do negócio, das tarefas e os arquivos enviados.</li>
          <li><strong>E-mail transacional</strong> (Resend): recebe o e-mail da usuária e o conteúdo da mensagem operacional, como a recuperação de senha.</li>
          <li><strong>Plataformas que a usuária conecta</strong> — hoje, por exemplo, o Instagram (Meta), o TikTok e programas de afiliados: recebem somente o necessário para a ação que ela autorizou, como a mídia e a legenda de uma publicação.</li>
          <li><strong>Provedor de mensagens de WhatsApp</strong> (Z-API), quando a usuária configurar e usar esse recurso: recebe os números e a mensagem que ela mandar enviar.</li>
          <li><strong>Provedores de inteligência artificial e de processamento de mídia</strong>, quando habilitados, nas condições da seção 4.</li>
          <li>Autoridades, quando houver obrigação legal ou ordem judicial.</li>
        </ul>
        <p className={p}>A lista atualizada de fornecedores pode ser pedida pelo canal da seção 11.</p>
      </section>

      <section className="space-y-3">
        <h2 className={h2}>6. Transferência internacional de dados</h2>
        <p className={p}>
          Parte do tratamento pode ocorrer fora do Brasil. Eventuais transferências internacionais de dados pessoais
          observarão a LGPD e a Resolução CD/ANPD nº 19/2024.
        </p>
        <div className="space-y-2">
          <h3 className={h3}>6.1 Hospedagem da aplicação (Netlify)</h3>
          <ul className={lista}>
            <li><strong>Onde:</strong> as funções que executam a aplicação — inclusive as que rodam em segundo plano e as agendadas — ficam na região padrão do plano contratado, nos Estados Unidos (us-east-2, Ohio). Antes de chegar a elas, cada acesso ao site passa pela rede global de entrega do fornecedor, que entrega os arquivos públicos e faz a verificação inicial da sessão. O fornecedor informa, em seus termos, que também pode tratar dados em outras localidades.</li>
            <li><strong>Finalidade:</strong> executar a aplicação, responder a cada acesso e realizar em segundo plano as tarefas que a usuária solicitar.</li>
            <li><strong>Categorias de dados:</strong> todas as que trafegam numa requisição — conta, negócio, integrações, mídia enviada e metadados técnicos — e, nas tarefas em segundo plano, os dados necessários à tarefa (por exemplo, a legenda de uma publicação ou os números e a mensagem de um envio de WhatsApp).</li>
            <li><strong>Armazenamento:</strong> os dados persistentes da conta e do negócio são armazenados no banco de dados descrito na seção 6.2. A hospedagem da aplicação pode manter registros técnicos e operacionais conforme os termos do fornecedor.</li>
          </ul>
          {e.transicaoDaVercel ? (
            <p className={p}>
              Durante a transição de hospedagem, por até 14 dias após a mudança, o serviço também pode ser atendido
              pelo fornecedor anterior (Vercel, Estados Unidos, região iad1), com a mesma finalidade e as mesmas
              categorias de dados.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <h3 className={h3}>6.2 Banco de dados e armazenamento (Supabase)</h3>
          <ul className={lista}>
            <li><strong>Região configurada:</strong> Brasil (região sa-east-1, São Paulo). O armazenamento principal dos dados fica no Brasil.</li>
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className={h3}>6.3 Demais fornecedores</h3>
          <p className={p}>
            O provedor de e-mail transacional (Resend), as plataformas que a usuária conecta (como a Meta) e, quando
            habilitados, o provedor de mensagens de WhatsApp (Z-API) e os provedores de inteligência artificial e de
            processamento de mídia podem realizar tratamento internacional conforme seus termos aplicáveis. As
            finalidades e as categorias de dados de cada um estão nas seções 4 e 5.
          </p>
        </div>
        <p className={p}>
          <strong>Mecanismo jurídico:</strong> para a hospedagem da aplicação (seção 6.1), a transferência
          internacional ocorre na medida necessária para executar o contrato com a usuária, a pedido dela — criar e
          manter a conta, guardar e exibir os dados do negócio, publicar os conteúdos que ela solicitar e enviar
          mensagens operacionais (art. 33, inciso IX, combinado com o art. 7º, inciso V, da LGPD, e art. 9º, inciso
          II, alínea &quot;c&quot;, do Regulamento aprovado pela Resolução CD/ANPD nº 19/2024). O fornecedor atua como
          operador, segundo as instruções da {e.razaoSocial}. Funcionalidades que tratem dados de terceiros, como o
          envio de mensagens de WhatsApp, ou dados fornecidos com base em consentimento, como a imagem e a voz do
          recurso de avatar, não são executadas pela hospedagem no exterior enquanto não houver mecanismo de
          transferência aplicável a elas. Quando alguém acessa um link da usuária, os dados técnicos da conexão
          passam pela rede do fornecedor apenas para concluir o redirecionamento, e a aplicação não armazena o
          endereço IP de quem acessa. Para os demais fornecedores, a {e.razaoSocial} valida o mecanismo antes da
          ativação ou da continuidade do uso de cada um. A titular pode pedir pelo canal da seção 11 informações
          sobre o mecanismo adotado para cada fornecedor.
        </p>
        <p className={p}>
          <strong>Medidas de segurança</strong> na transferência: tráfego somente por conexão criptografada (HTTPS) e
          as medidas da seção 10. <strong>Direitos:</strong> os da seção 11 valem também para os dados transferidos.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>7. Cookies e armazenamento no navegador</h2>
        <p className={p}>
          O {e.produto} usa apenas cookies estritamente necessários ao funcionamento, emitidos pelo próprio site{' '}
          {e.dominio}:
        </p>
        <ul className={lista}>
          <li><strong>Cookie de sessão:</strong> mantém a usuária conectada. Validade de até 30 dias.</li>
          <li><strong>Cookie de proteção contra falsificação de requisição (CSRF):</strong> protege o login.</li>
          <li><strong>Cookie de retorno após o login:</strong> lembra a página que a usuária queria abrir.</li>
        </ul>
        <p className={p}>
          Todos são próprios, inacessíveis a scripts (HttpOnly) e enviados somente por conexão segura. Não usamos
          cookies de publicidade nem de análise, e não carregamos scripts de terceiros no navegador.
        </p>
        <p className={p}>
          <strong>Armazenamento local do navegador:</strong> na tela de envio por WhatsApp, os números de contato
          salvos ficam no armazenamento local do navegador da própria usuária. Eles podem ser apagados na própria
          tela ou limpando os dados do navegador. Os envios já comandados ficam registrados no servidor, como
          descrito na seção 1.
        </p>
        <p className={p}>
          No envio de imagens e vídeos, o arquivo vai do navegador diretamente para o provedor de armazenamento
          (seção 5).
        </p>
      </section>

      <section className="space-y-2">
        <h2 id="exclusao" className={`${h2} scroll-mt-20`}>8. Retenção e exclusão</h2>
        <p className={p}>
          Os dados são mantidos pelo tempo necessário às finalidades desta política e ao cumprimento das obrigações
          legais aplicáveis. Salvo os registros de tarefas descritos a seguir, não há prazos fixos por categoria: o
          período fica limitado a essas necessidades.
        </p>
        <h3 className={h3}>Registros de tarefas em segundo plano</h3>
        <ul className={lista}>
          <li>Registros de tarefas concluídas que contenham dados pessoais operacionais — como os números e a mensagem de um envio de WhatsApp — são anonimizados após 30 dias sem atividade.</li>
          <li>Após a anonimização, permanecem apenas os dados mínimos necessários ao controle técnico: o estado da tarefa, contagens e o identificador que impede que o mesmo pedido seja repetido.</li>
          <li>O registro anonimizado é excluído após 180 dias contados da última atividade.</li>
          <li>Tarefas ativas — em andamento ou aguardando execução — não entram nesse processo.</li>
          <li>Registros sujeitos a obrigação legal ou necessários ao exercício regular de direitos podem ser conservados, quando aplicável.</li>
        </ul>
        <h3 className={h3}>Encerramento da conta e exclusão de dados</h3>
        <p className={p}>
          A titular pode solicitar o encerramento da conta e a exclusão dos dados pelo canal da seção 11. A exclusão
          é processada conforme procedimento interno e as obrigações legais aplicáveis.
        </p>
        <ul className={lista}>
          <li><strong>São excluídos:</strong> dados da conta, produtos, conteúdos, links, mídia enviada, credenciais e tokens de integração, registros das tarefas em segundo plano (inclusive números e mensagens de envios por WhatsApp) e os arquivos de imagem e voz do recurso de avatar.</li>
          <li>
            <strong>Podem ser mantidos</strong>, pelo tempo necessário e com acesso restrito:
            <ul className="list-[circle] pl-6 space-y-1">
              <li>registros de vendas e comissões, para cumprimento de obrigação legal e prestação de contas;</li>
              <li>registros de auditoria e de consentimento (inclusive de sua revogação), para exercício regular de direitos e prevenção a fraudes.</li>
            </ul>
          </li>
          <li><strong>Desconexão de uma integração:</strong> ao desconectar uma plataforma em Integrações, os tokens de acesso e o identificador da conta são apagados do servidor; no TikTok, o {e.produto} também pede à plataforma a revogação da autorização. A usuária pode ainda revogar o acesso diretamente nas configurações de permissões de aplicativos da própria plataforma.</li>
          <li><strong>Revogação do consentimento de imagem e voz:</strong> o recurso de avatar é desativado na hora e deixa de gerar conteúdo. A exclusão dos arquivos de referência pode ser solicitada pelo canal da seção 11.</li>
          <li><strong>Prévias do avatar:</strong> recebem marcação de expiração de 7 dias. A exclusão dos arquivos segue o procedimento interno de retenção e pode ser solicitada a qualquer momento pelo canal da seção 11.</li>
        </ul>
        <p className={p}>
          Conteúdo já publicado em plataformas de terceiros, a pedido da usuária, segue as regras dessas plataformas e
          é removido nelas pela própria usuária.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>9. Propriedade da mídia e do conteúdo</h2>
        <p className={p}>
          Enviar mídia ou conteúdo ao {e.produto} para processamento, armazenamento ou publicação
          <strong> não transfere a propriedade intelectual</strong> desse material à {e.razaoSocial}. Os{' '}
          <Link className="underline" href="/termos">Termos de Uso</Link> detalham o uso que o {e.produto} pode fazer
          desse material para executar o serviço.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>10. Segurança</h2>
        <ul className={lista}>
          <li>Áreas privadas acessíveis somente com autenticação; cada conta só acessa os próprios dados.</li>
          <li>Senhas armazenadas apenas como hash (bcrypt).</li>
          <li>Tráfego somente por conexão criptografada (HTTPS); cookies de sessão inacessíveis a scripts.</li>
          <li>Credenciais e tokens de integração armazenados no servidor, com acesso restrito à aplicação, e nunca enviados ao navegador.</li>
          <li>Ambientes de teste e de pré-visualização separados do ambiente de produção: eles não acessam o banco de dados de produção.</li>
          <li>Tarefas em segundo plano só são executadas mediante pedido autenticado pela própria aplicação.</li>
          <li>Arquivos de imagem e voz do recurso de avatar em armazenamento privado, acessíveis só por link temporário.</li>
          <li>Imagens e vídeos enviados para publicação ficam em armazenamento com endereço público, necessário para que as plataformas conectadas busquem o arquivo.</li>
          <li>Registros de auditoria sem senhas nem tokens.</li>
        </ul>
        <p className={p}>
          Nenhum sistema é totalmente imune a incidentes. Havendo incidente de segurança que possa acarretar risco ou
          dano relevante aos titulares, a comunicação à ANPD e aos titulares seguirá o art. 48 da LGPD e o
          Regulamento de Comunicação de Incidente de Segurança (Resolução CD/ANPD nº 15/2024).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>11. Direitos da titular e canal de atendimento</h2>
        <p className={p}>Nos termos dos arts. 18 e 20 da LGPD, a titular pode, a qualquer momento, solicitar:</p>
        <ul className={lista}>
          <li>confirmação da existência de tratamento;</li>
          <li>acesso aos dados;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD;</li>
          <li>portabilidade dos dados a outro fornecedor, observados os segredos comercial e industrial;</li>
          <li>eliminação dos dados tratados com base no consentimento, ressalvadas as hipóteses de conservação do art. 16;</li>
          <li>informação sobre as entidades com as quais os dados são compartilhados;</li>
          <li>informação sobre a possibilidade de não fornecer consentimento e sobre as consequências da negativa;</li>
          <li>revogação do consentimento;</li>
          <li>oposição a tratamento realizado com fundamento em outra base legal, em caso de descumprimento da LGPD (art. 18, § 2º);</li>
          <li>revisão de decisões tomadas unicamente com base em tratamento automatizado que afetem seus interesses (art. 20).</li>
        </ul>
        <p className={p}>
          A titular também pode peticionar perante a Autoridade Nacional de Proteção de Dados (ANPD) (art. 18, § 1º).
        </p>
        <h3 className={h3}>Canal de Privacidade e Proteção de Dados</h3>
        <p className={p}>
          Pedidos e dúvidas sobre dados pessoais, inclusive o exercício dos direitos acima:{' '}
          <a className="underline" href={`mailto:${e.contato}`}>{e.contato}</a>.
        </p>
        <p className={p}>
          Veja também os <Link className="underline" href="/termos">Termos de Uso</Link>.
        </p>
      </section>
    </article>
  )
}
