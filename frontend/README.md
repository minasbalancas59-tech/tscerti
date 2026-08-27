# Frontend (PWA)

O frontend será criado na Etapa 3 com Vite + React:

    npm create vite@latest app -- --template react-ts
    cd app && npm install

Estrutura prevista:

    app/
      src/
        paginas/
          tecnico/      # tela de lançamento de ensaio
          aprovacao/    # painel do responsável técnico
          portal/       # área do cliente
          validar/      # página pública do QR Code
        api/            # cliente HTTP (fetch com JWT)
        offline/        # IndexedDB + fila de sincronização (Etapa 6)

O modo PWA/offline (service worker, manifest) entra apenas na Etapa 6 —
não complique antes da hora.
