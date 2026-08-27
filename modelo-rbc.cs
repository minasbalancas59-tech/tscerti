
    // ═══════════════════════════════════════════════════════════
    // MODELO RBC — certificado de calibração acreditado (ISO/IEC 17025).
    // Diferente dos demais: DECLARA resultados com incerteza, sem
    // julgamento de conformidade (não há EMA nem "Conforme").
    // ═══════════════════════════════════════════════════════════
    static byte[] GerarModeloRbc(DadosCertificado d, byte[]? qrPng, byte[]? logoPng,
        byte[]? assinTecnico, byte[]? assinAprovador, string? marcaDagua, string cor,
        byte[]? seloRbc)
    {
        var r = d.Rbc!;
        // Casas para incerteza/média: 2 a mais que a divisão (a média cai entre divisões)
        int casasU = d.CasasDecimais + 2;

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0.9f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(9).FontColor("#1c2b33"));

                if (!string.IsNullOrEmpty(marcaDagua))
                    page.Foreground().AlignCenter().AlignMiddle()
                        .Rotate(-35).Text(marcaDagua)
                        .FontSize(120).Bold().FontColor("#20E53935");

                // ── Cabeçalho ──────────────────────────────────
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        if (logoPng is not null)
                            row.ConstantItem(90).PaddingRight(8).MaxHeight(55)
                               .Image(logoPng).FitArea();
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(d.Empresa).FontSize(14).Bold().FontColor(cor);
                            if (d.EnderecoEmpresa is not null)
                                c.Item().Text(d.EnderecoEmpresa).FontSize(8);
                            if (d.CidadeUfEmpresa is not null)
                                c.Item().Text(d.CidadeUfEmpresa).FontSize(8);
                        });
                        row.ConstantItem(190).Column(c =>
                        {
                            c.Item().AlignRight().Text("CERTIFICADO DE CALIBRAÇÃO")
                                .FontSize(12).Bold().FontColor(cor);
                            c.Item().AlignRight().Text($"Nº {d.Numero}").FontSize(11).Bold();
                            c.Item().AlignRight().Text($"Emissão: {d.DataEmissao:dd/MM/yyyy}").FontSize(8);
                            if (!string.IsNullOrWhiteSpace(r.NumAcreditacao))
                                c.Item().AlignRight().PaddingTop(2)
                                    .Text($"Acreditação Cgcre nº {r.NumAcreditacao}")
                                    .FontSize(8).Bold().FontColor(cor);
                            if (seloRbc is not null)
                                c.Item().AlignRight().PaddingTop(3).Width(70).Image(seloRbc).FitArea();
                        });
                    });
                    col.Item().PaddingTop(4).LineHorizontal(1).LineColor(cor);
                });

                page.Content().PaddingVertical(6).Column(col =>
                {
                    col.Spacing(7);

                    // ── Cliente e instrumento ──────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("CLIENTE").FontSize(7).Bold().FontColor("#667");
                            c.Item().Text(d.Cliente).Bold();
                            if (d.CnpjCliente is not null) c.Item().Text($"CNPJ: {d.CnpjCliente}").FontSize(8);
                            if (d.EnderecoCliente is not null) c.Item().Text(d.EnderecoCliente).FontSize(8);
                            var cidUf = string.Join(" · ", new[] { d.CidadeCliente, d.UfCliente }
                                .Where(x => !string.IsNullOrWhiteSpace(x)));
                            if (cidUf.Length > 0) c.Item().Text(cidUf).FontSize(8);
                        });
                        row.ConstantItem(14);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("INSTRUMENTO").FontSize(7).Bold().FontColor("#667");
                            var marcaModelo = $"{d.Marca ?? ""} {d.Modelo ?? ""}".Trim();
                            c.Item().Text(marcaModelo.Length > 0 ? marcaModelo : "—").Bold();
                            c.Item().Text($"Identificação: {d.Balanca}").FontSize(8);
                            if (d.NumSerie is not null) c.Item().Text($"Nº de série: {d.NumSerie}").FontSize(8);
                            c.Item().Text($"Capacidade: {Val(d.Capacidade, d.CasasDecimais)} {d.Unidade} · " +
                                          $"e = {Val(d.DivisaoE, d.CasasDecimais)} {d.Unidade}").FontSize(8);
                            if (d.NumeroInmetro is not null) c.Item().Text($"Inmetro: {d.NumeroInmetro}").FontSize(8);
                        });
                    });

                    // ── Condições ──────────────────────────────
                    col.Item().Background("#f5f8f7").Padding(5).Row(row =>
                    {
                        void Info(string rot, string? v)
                        {
                            if (string.IsNullOrWhiteSpace(v)) return;
                            row.RelativeItem().Text(t => { t.Span(rot + ": ").FontSize(7.5f).FontColor("#667");
                                t.Span(v).FontSize(8).Bold(); });
                        }
                        Info("Data da calibração", d.DataCalibracao?.ToString("dd/MM/yyyy"));
                        Info("Local", d.LocalTipo == "laboratorio" ? "Laboratório" : "In loco (cliente)");
                        Info("Temperatura", d.Temperatura is null ? null : $"{d.Temperatura:0.0} °C");
                        Info("Umidade", d.Umidade is null ? null : $"{d.Umidade:0} %");
                        Info("Pressão", r.Pressao is null ? null : $"{r.Pressao:0.0} hPa");
                    });

                    // ── 1 · Resultados (o coração do RBC) ──────
                    col.Item().Text("1 · Resultados da calibração").Bold().FontColor(cor);
                    col.Item().Table(t =>
                    {
                        t.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn();
                            c.RelativeColumn(); c.ConstantColumn(38);
                        });
                        void Head(string s) => t.Cell().Background("#eef3f1").Padding(4)
                            .AlignCenter().Text(s).FontSize(8).Bold();
                        Head($"Carga ({d.Unidade})"); Head($"Indicação média ({d.Unidade})");
                        Head($"Erro ({d.Unidade})"); Head($"Incerteza U ({d.Unidade})"); Head("k");
                        foreach (var l in r.Resultados)
                        {
                            void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                .Padding(4).AlignCenter().Text(s).FontSize(8);
                            C(Val(l.Carga, d.CasasDecimais));
                            C(Val(l.Media, casasU));
                            C((l.Erro > 0 ? "+" : "") + Val(l.Erro, casasU));
                            C("± " + Val(l.U, casasU));
                            C(Val(l.K, 2));
                        }
                    });
                    col.Item().Text("A incerteza expandida U foi calculada com o fator de abrangência k indicado, " +
                                    "correspondente a uma probabilidade de abrangência de aproximadamente 95,45 %.")
                       .FontSize(7).Italic().FontColor("#667");

                    // ── 2 · Excentricidade e 3 · Mobilidade ────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("2 · Excentricidade").Bold().FontColor(cor);
                            if (r.Excentricidade.Count == 0)
                                c.Item().Text("Não realizado.").FontSize(8).FontColor("#667");
                            else
                            {
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.RelativeColumn(); x.RelativeColumn(); x.RelativeColumn(); });
                                    void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                        .AlignCenter().Text(s).FontSize(7.5f).Bold();
                                    Head("Posição"); Head($"Média ({d.Unidade})"); Head($"Erro ({d.Unidade})");
                                    foreach (var x in r.Excentricidade)
                                    {
                                        void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                            .Padding(3).AlignCenter().Text(s).FontSize(7.5f);
                                        C(x.Posicao); C(Val(x.Media, casasU));
                                        C(x.Posicao == "1" ? "ref." : (x.Erro > 0 ? "+" : "") + Val(x.Erro, casasU));
                                    }
                                });
                                if (r.MaiorErroExc is { } me)
                                    c.Item().PaddingTop(2).Text($"Maior erro: {Val(me, casasU)} {d.Unidade} " +
                                        "(considerado na incerteza de cada carga).").FontSize(7).Italic().FontColor("#667");
                            }
                        });
                        row.ConstantItem(14);
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("3 · Mobilidade").Bold().FontColor(cor);
                            if (r.Mobilidade.Count == 0)
                                c.Item().Text("Não realizado.").FontSize(8).FontColor("#667");
                            else
                            {
                                if (r.MobCargaRef is { } cr)
                                    c.Item().Text($"Carga de referência: {Val(cr, d.CasasDecimais)} {d.Unidade} " +
                                        $"+ {Val(r.MobDivisao ?? 0, d.CasasDecimais)} {d.Unidade}").FontSize(7.5f);
                                c.Item().Table(t =>
                                {
                                    t.ColumnsDefinition(x => { x.RelativeColumn(); x.RelativeColumn(); });
                                    void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                        .AlignCenter().Text(s).FontSize(7.5f).Bold();
                                    Head("Leitura"); Head($"Indicação ({d.Unidade})");
                                    foreach (var m in r.Mobilidade)
                                    {
                                        void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                            .Padding(3).AlignCenter().Text(s).FontSize(7.5f);
                                        C(m.Ordem.ToString()); C(Val(m.Leitura, d.CasasDecimais));
                                    }
                                });
                                c.Item().PaddingTop(2).Text("Ensaio de caracterização; não integra o cálculo da incerteza.")
                                   .FontSize(7).Italic().FontColor("#667");
                            }
                        });
                    });

                    // ── 4 · Rastreabilidade ────────────────────
                    col.Item().Text("4 · Rastreabilidade — padrões utilizados").Bold().FontColor(cor);
                    if (r.PesosRbc.Count == 0)
                        col.Item().Text("—").FontSize(8);
                    else
                        col.Item().Table(t =>
                        {
                            t.ColumnsDefinition(c =>
                            { c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn();
                              c.RelativeColumn(); c.RelativeColumn(); });
                            void Head(string s) => t.Cell().Background("#eef3f1").Padding(3)
                                .Text(s).FontSize(7.5f).Bold();
                            Head("Carga"); Head("Padrão"); Head("Valor nominal");
                            Head($"Valor convencional ({d.Unidade})"); Head("Certificado");
                            foreach (var w in r.PesosRbc)
                            {
                                void C(string s) => t.Cell().BorderBottom(0.5f).BorderColor("#e6e6e6")
                                    .Padding(3).Text(s).FontSize(7.5f);
                                C(w.OrdemPonto.ToString());
                                C(w.Identificacao);
                                C(w.ValorNominal ?? "—");
                                C(w.Convencional is null ? "—" : Val(w.Convencional.Value, casasU));
                                C(w.NumCertificado ?? "—");
                            }
                        });

                    // ── Declarações ────────────────────────────
                    col.Item().PaddingTop(3).Column(c =>
                    {
                        c.Item().Text(t =>
                        {
                            t.Span("Método: ").Bold();
                            t.Span(d.Metodo == "-" ? "Calibração por comparação direta com massas padrão rastreadas ao SI, " +
                                "conforme EURAMET cg-18 e o Guia para a Expressão da Incerteza de Medição (GUM)." : d.Metodo);
                        });
                        c.Item().Text(t =>
                        {
                            t.Span("Incerteza de medição: ").Bold();
                            t.Span("estimada conforme o GUM, combinando em quadratura as contribuições de repetibilidade, " +
                                   "resolução do instrumento, incerteza dos padrões, excentricidade e empuxo do ar (CIPM-2007). " +
                                   "Os graus de liberdade efetivos foram estimados pela fórmula de Welch-Satterthwaite.");
                        });
                        c.Item().Text(t =>
                        {
                            t.Span("Declaração: ").Bold();
                            t.Span("os resultados referem-se exclusivamente ao instrumento calibrado, nas condições " +
                                   "descritas e no momento da calibração. Este certificado não implica julgamento de " +
                                   "conformidade com requisitos regulamentares. Reprodução permitida somente na íntegra.");
                        });
                        if (d.TextoPeriodicidade is not null)
                            c.Item().Text(d.TextoPeriodicidade).FontSize(8).Italic();
                    });

                    // ── Assinaturas + QR ───────────────────────
                    col.Item().PaddingTop(6).Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            if (assinTecnico is not null)
                                c.Item().Height(32).AlignCenter().Image(assinTecnico).FitArea();
                            else c.Item().Height(32);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Tecnico).FontSize(8);
                            c.Item().Text("Técnico executor").FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(30);
                        row.RelativeItem().Column(c =>
                        {
                            if (assinAprovador is not null)
                                c.Item().Height(32).AlignCenter().Image(assinAprovador).FitArea();
                            else c.Item().Height(32);
                            c.Item().LineHorizontal(0.5f).LineColor("#333");
                            c.Item().Text(d.Aprovador ?? "—").FontSize(8);
                            c.Item().Text($"Signatário autorizado{(d.RegistroAprovador is null ? "" : " · " + d.RegistroAprovador)}")
                               .FontSize(7).FontColor("#667");
                        });
                        row.ConstantItem(20);
                        if (qrPng is not null)
                            row.ConstantItem(70).Column(c =>
                            {
                                c.Item().Width(64).Image(qrPng);
                                c.Item().Text("Validar autenticidade").FontSize(6).AlignCenter().FontColor("#667");
                            });
                    });

                    if (d.TextoRodape is not null)
                        col.Item().PaddingTop(4).Text(d.TextoRodape).FontSize(7).FontColor("#667");
                });

                page.Footer().Column(col =>
                {
                    col.Item().LineHorizontal(0.5f).LineColor("#ccc");
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"Validação: {d.UrlBase}/validar/{d.UuidValidacao}")
                           .FontSize(6).FontColor("#667");
                        row.RelativeItem().AlignRight().Text(t =>
                        {
                            t.Span("Certificado ").FontSize(6).FontColor("#667");
                            t.Span(d.Numero).FontSize(6).FontColor("#667");
                            t.Span(" · Página ").FontSize(6).FontColor("#667");
                            t.CurrentPageNumber().FontSize(6).FontColor("#667");
                            t.Span(" de ").FontSize(6).FontColor("#667");
                            t.TotalPages().FontSize(6).FontColor("#667");
                        });
                    });
                    col.Item().AlignCenter().Text("— fim do documento —").FontSize(6).FontColor("#aaa");
                });
            });
        }).GeneratePdf();
    }
