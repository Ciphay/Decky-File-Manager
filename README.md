# SteamOS File Manager

Plugin para o Decky Loader que fornece um gerenciador de arquivos para Steam Deck e Bazzite.

## Funcionalidades

- navegação por diretórios;
- filtro de arquivos, pastas e itens ocultos;
- ordenação alfabética;
- copiar, recortar e colar;
- tratamento de conflitos de nomes;
- criar pastas;
- renomear e excluir itens;
- extrair arquivos ZIP e TAR com validação contra path traversal;
- visualizar propriedades de arquivos e pastas;
- navegação completa pelo controle do Steam Deck.

## Estrutura

- `src/index.tsx`: interface React/TypeScript e integração com a interface do Decky;
- `main.py`: backend Python e operações de sistema de arquivos;
- `plugin.json`: metadados do plugin;
- `dist`: bundle gerado pelo Rollup.

## Desenvolvimento

Requisitos: Node.js 16.14 ou superior e pnpm 9.

Instale as dependências e compile o frontend:

```bash
pnpm install
pnpm run build
```

Para criar o pacote instalável:

```bash
pnpm run package
```

O comando gera `steamos-file-manager.zip` na raiz do projeto.

## Backend

O backend é carregado pelo Decky Loader e expõe funções assíncronas ao frontend por meio de `callable()` do `@decky/api`. Configurações e estado temporário são armazenados nos diretórios recomendados pelo Decky.

As operações de extração rejeitam caminhos absolutos, path traversal, links simbólicos e tipos especiais de arquivos em arquivos TAR.

## Licença

Consulte [LICENSE](LICENSE).
