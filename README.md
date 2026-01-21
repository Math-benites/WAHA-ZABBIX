# Stack Zabbix + WAHA + api_message_zabbix

Ambiente Docker Compose pronto para subir Zabbix (server/web/agent + MySQL), WAHA (WhatsApp) e um microservico de webhook (`api_message_zabbix`) que recebe alertas do Zabbix e encaminha para o WAHA.

## Requisitos
- Linux/WSL com Docker Engine 23+ e Docker Compose v2.3+.
- Git instalado.
- Portas livres: 8080 (Zabbix web), 10051 (server), 10050 (agent), 4000 (WAHA), 4100 (api_message_zabbix). Outras opcional: 6379 (Redis), 5432 (Postgres).

## Subir rapido
```bash
mkdir -p /opt/app && cd /opt/app
git clone https://github.com/portergroup-ti/WAHA-ZABBIX.git .
docker compose up -d
```
Checar saude:
```bash
docker compose ps
```

## Acessos
- Zabbix Frontend: http://SEU_HOST:8080 (login inicial: Admin / zabbix).
- WAHA dashboard/API: http://SEU_HOST:4000 (crie a sessao `default` e pareie com WhatsApp).
- api_message_zabbix health: http://SEU_HOST:4100/health

## Ajustes de variaveis
- Secrets de banco em `env_vars/.MYSQL_*` e `env_vars/.POSTGRES_*` (um valor por arquivo).
- Parametros do Zabbix em `env_vars/.env_srv` e `env_vars/.env_web`.
- Se quiser chave de protecao no webhook, defina `API_KEY` no servico `api-message-zabbix` do `docker-compose.yml` e use o mesmo valor no Media Type (header `X-Api-Key`).

## Configurar WAHA
1) Acesse http://SEU_HOST:4000.
2) Crie/edite a sessao `default` (mesmo nome de `WAHA_SESSION` no compose).
3) Escaneie o QR Code e confirme status CONNECTED.

## Media Type no Zabbix (Webhook WhatsApp)
1) Administration -> Media types -> Create media type.
2) Tipo: Webhook. Nome: WAHA WhatsApp.
3) Parametros:
   - url: `http://api-message-zabbix:3000/send` (host interno do compose)
   - to: `{ALERT.SENDTO}`
   - text: `{ALERT.SUBJECT}\n{ALERT.MESSAGE}`
   - api_key: (preencha se `API_KEY` estiver setado)
   - group: `0` para contato (default), `1` para grupo (apenas quando quiser enviar a grupos)
4) Script:
```javascript
var params = value;
if (typeof params === 'string') { try { params = JSON.parse(params); } catch (e) { params = {}; } }
var url = params.url || 'http://api-message-zabbix:3000/send';
var to = (params.to || '').replace(/\D/g, '');
var text = params.text || '';
var isGroup = false;
if (params.group !== undefined) {
  var g = params.group;
  isGroup = g === true || g === 'true' || g === '1' || g === 1 || g === 'yes';
}
var body = { to: to, text: text, group: isGroup };
var req = new HttpRequest();
req.addHeader('Content-Type', 'application/json');
if (params.api_key) { req.addHeader('X-Api-Key', params.api_key); }
var resp = req.post(url, JSON.stringify(body));
var status = req.getStatus();
if (status !== 200) { throw 'request failed status=' + status + ' body=' + resp; }
return 'OK';
```
5) Em Users -> Media, adicione o numero (somente digitos) no tipo WAHA WhatsApp.
6) Amarre em uma Action para os triggers desejados.

### Enviando para grupos
- No parametro `group`, use `1` (ou `true`) para enviar para grupos; deixe `0` ou vazio para contatos individuais.
- O campo `to` deve receber o ID do grupo sem o sufixo (`120363393301111563`, por exemplo). O webhook acrescenta `@g.us` automaticamente quando `group` for verdadeiro.
- Para contatos, continue usando apenas os dígitos (o webhook acrescenta `@c.us`).

## Testes rapidos
- Do host (contato):
```bash
curl -X POST "http://SEU_HOST:4100/send?to=5599999999999&text=teste"
```
- Do host (grupo):
```bash
curl -X POST "http://SEU_HOST:4100/send?to=120363393301111563&text=TesteGrupo&group=true"
```
- De dentro do container Zabbix server (rede interna, contato):
```bash
docker compose exec zabbix-server \
  curl -X POST "http://api-message-zabbix:3000/send" \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"5599999999999\",\"text\":\"teste\"}"
```
- De dentro do container Zabbix server (rede interna, grupo):
```bash
docker compose exec zabbix-server \
  curl -X POST "http://api-message-zabbix:3000/send" \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"120363393301111563\",\"text\":\"TesteGrupo\",\"group\":true}"
```

## Problemas comuns
- Sessao WAHA desconectada: refaca o QR Code em http://SEU_HOST:4000.
- 401 no webhook: alinhe `API_KEY` entre compose e Media Type.
- 5xx no api_message_zabbix: veja logs `docker compose logs -f api-message-zabbix` e confirme que WAHA responde em `http://waha:3000/api/sendText`.
- Mensagem nao chega: numero com apenas digitos, sem + ou parenteses, e WhatsApp ativo.
