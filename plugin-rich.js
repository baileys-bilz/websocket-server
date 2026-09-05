/**
 * WhatsApp Rich Response - WebSocket Plugin
 * 
 * Plugin untuk bot Baileys yang mengirim Rich Response
 * dengan HTML terminal UI + WebSocket realtime connection.
 * 
 * Cara pakai:
 * 1. Deploy websocket-server ke Railway
 * 2. Copy file ini ke folder plugins bot WhatsApp kamu
 * 3. Ganti WS_URL dengan URL Railway kamu
 * 4. Kirim .rich di chat WhatsApp
 */

const WS_URL = 'wss://websocket-server-production-3a7b.up.railway.app';

const sources = [
  {
    source_type: 'THIRD_PARTY',
    source_display_name: 'Rich WebSocket',
    source_subtitle: 'Realtime Connection',
    source_url: WS_URL,
    favicon: {
      url: 'https://cdn-icons-png.flaticon.com/512/2166/2166823.png',
      mime_type: 'image/png',
      width: 16,
      height: 16
    }
  }
];

module.exports = {
  command: ['.rich', '.ws'],
  tags: ['tools'],
  help: '.rich - Kirim WebSocket Rich Response',

  async run(conn, m, { text }) {
    const {
      proto,
      generateWAMessageFromContent,
      generateMessageIDV2
    } = await import('@whiskeysockets/baileys');

    // Fetch HTML dari server
    let html;
    try {
      const res = await fetch(WS_URL + '/rich');
      html = await res.text();
    } catch (e) {
      return m.reply('❌ Gagal fetch HTML dari server: ' + e.message);
    }

    // Build rich response
    const richResponseMessage = {
      messageType: 1,

      submessages: [
        {
          messageType:
            proto
              .AIRichResponseSubMessageType
              .AI_RICH_RESPONSE_TEXT,

          messageText: 'WebSocket Rich Response'
        }
      ],

      unifiedResponse: {
        data:
          Buffer.from(
            JSON.stringify({
              response_id: generateMessageIDV2(),

              sections: [
                {
                  view_model: {
                    primitive: {
                      __typename:
                        'GenAIaeacdsnwHtmlPrimitive',

                      payload: html,

                      trusted_sources:
                        sources.map(x => x.source_url)
                    },

                    __typename:
                      'GenAISingleLayoutViewModel'
                  }
                }
              ]
            })
          ).toString('base64')
      },

      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedAiBotMessageInfo: {
          botJid: '0@bot'
        },
        forwardOrigin: 4
      }
    };

    const isi = {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,

        botMetadata: {
          messageDisclaimerText:
            'WebSocket Rich',

          richResponseSourcesMetadata: {
            sources
          }
        }
      },

      botForwardedMessage: {
        message: {
          richResponseMessage
        }
      }
    };

    const msg =
      generateWAMessageFromContent(
        m.chat,
        isi,
        {
          messageId:
            generateMessageIDV2()
        }
      );

    await conn.relayMessage(
      m.chat,
      msg.message,
      {
        messageId: msg.key.id
      }
    );

    return m.reply('✅ Rich WebSocket terkirim');
  }
};
