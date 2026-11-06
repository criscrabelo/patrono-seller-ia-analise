# Digital Twin — Instalação no Windows da Proprietária

**Criado:** Rodada 9 (Worker Local + Primeira Voz Real). Guia em linguagem simples para instalar, uma única vez, o "processador de vídeos" (worker) do Digital Twin no computador da proprietária.

Depois deste guia, o dia a dia é: usar o site do Patrono normalmente. O processador de vídeos roda sozinho em segundo plano — nenhum terminal, nenhum comando, nenhum passo técnico repetido.

## O que você precisa antes de começar

- Windows 10 ou 11.
- [Python 3.11](https://www.python.org/downloads/) instalado (marque a opção "Add Python to PATH" durante a instalação).
- Conexão com a internet.
- (Opcional, só se você tiver) uma placa de vídeo NVIDIA — melhora a qualidade do avatar, mas **não é obrigatória**. Sem ela, o Patrono usa um modo mais simples que também funciona de verdade.

Você **não** precisa saber programar. Os passos abaixo são só abrir a pasta e clicar/rodar os scripts indicados.

## Passo 1 — Diagnóstico (não muda nada no seu computador)

Rode `worker/diagnose-digital-twin-worker.ps1`. Ele só **olha** o que seu computador tem — nunca instala ou altera nada. Ao final, ele mostra se o seu computador está classificado como:

| Classificação | O que significa |
|---|---|
| **Digital Twin completo** | Voz clonada + avatar com sincronização labial funcionam de verdade. |
| **Voz e avatar (modo leve de vídeo)** | Voz clonada funciona bem; o avatar sincronizado pode ficar mais lento. |
| **Só voz clonada** | Sua voz digital funciona; o avatar com sincronização labial ainda não. |
| **Só modo simples (motion graphics)** | O Patrono continua publicando conteúdo (produto, texto, legendas, movimento), só sem voz/avatar clonados ainda. |
| **Indisponível** | Falta algo básico (Python, espaço em disco) — o diagnóstico diz exatamente o quê. |

Essa classificação nunca é um "não" definitivo — ela reflete o que seu computador tem **agora**. Instalar o que falta (Python, espaço em disco) e rodar de novo pode mudar o resultado.

## Passo 2 — Instalação assistida

Rode `worker/setup-digital-twin-worker.ps1`. Ele:

1. Confirma que o Python está instalado.
2. Verifica se há uma placa de vídeo NVIDIA (só verifica — **nunca instala ou atualiza o driver da placa de vídeo sozinho**; se faltar algo aí, o script para e explica o que fazer).
3. Cria uma "caixinha isolada" (ambiente virtual Python) só para o Patrono — nunca mexe no Python que você já usa para outras coisas.
4. Instala as bibliotecas necessárias, com versões fixas (nunca uma versão surpresa diferente da testada).
5. Pergunta se você quer que o processador de vídeos **inicie sozinho** toda vez que você ligar o computador. Se disser "sim", isso é configurado usando um recurso nativo do próprio Windows (Agendador de Tarefas) — nada de terceiros.

## Passo 3 — Ligar o processador de vídeos

Se você disse "sim" no passo anterior, não precisa fazer nada — ele já liga sozinho na próxima vez que você entrar no Windows.

Se preferir ligar manualmente (ou não configurou o início automático), rode `worker/start-digital-twin-worker.ps1`.

## Ver o status a qualquer momento

Rode `worker/status-digital-twin-worker.ps1`. Ele mostra, em português simples:

- **Processador de vídeos: CONECTADO** ou **DESLIGADO**.
- **Início automático: ATIVADO** ou **DESATIVADO**.

## Desligar ou desativar o início automático

- Para parar o processador agora: `worker/stop-digital-twin-worker.ps1`.
- Para também desligar o início automático (ele não liga mais sozinho no próximo logon): `worker/stop-digital-twin-worker.ps1 -RemoverInicioAutomatico`.
- Para reativar o início automático depois, rode `setup-digital-twin-worker.ps1` de novo e responda "sim" quando ele perguntar.

## Conectar o processador à sua conta (pairing seguro)

O processador de vídeos nunca usa sua senha do Patrono. Em **Configurações → Digital Twin**, você gera um código próprio (token) exclusivo do seu computador — ele só acessa os vídeos do seu próprio negócio, nunca de outra conta, e pode ser desativado a qualquer momento pelo próprio site, sem precisar mexer no computador.

## Três interruptores independentes

Você controla três coisas separadamente, sem que uma afete a outra:

1. **Autopilot** (publicar sozinho) — liga/desliga em Configurações.
2. **Digital Twin** (usar sua identidade/voz) — liga/desliga em Configurações → Digital Twin.
3. **Processador de vídeos (worker)** — pausar isso só impede que vídeos sejam processados no seu computador; o resto do Patrono continua funcionando normalmente.

## O que fazer se der errado

- **"Aguardando o processador de vídeos"** na tela: o processador está desligado ou seu computador está desligado/dormindo. Ligue o computador ou rode `start-digital-twin-worker.ps1` — o vídeo nunca é perdido, ele só espera.
- **Falta de espaço em disco / GPU / Python**: rode o diagnóstico (`diagnose-digital-twin-worker.ps1`) de novo — ele sempre diz exatamente o que falta, sem termos técnicos difíceis de entender.
- **Dúvida sobre baixar modelos grandes**: antes de qualquer download grande, o Patrono mostra o tamanho aproximado do arquivo. Se a internet cair no meio, o download continua de onde parou na próxima tentativa — nunca recomeça do zero.

## Custo

R$ 0,00 — todo o processamento roda no seu próprio computador. Nenhum serviço de nuvem paga é usado para isso.
