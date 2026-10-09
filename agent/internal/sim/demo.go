package sim

func f(v float64) *float64 { return &v }

// Demo is the same bench as DEMO_SLAVES in packages/transport.
func Demo() []SlaveConfig {
	return []SlaveConfig{
		{
			UnitID: 1, Name: "Inversor de frequência",
			DeviceID: map[byte]string{0: "ModField", 1: "DEMO-INV", 2: "1.4.2", 4: "Inversor demo", 5: "INV-7.5"},
			Points: []Point{
				{Table: "holding", Address: 0, Type: "UINT16", Generator: Generator{Kind: "fixed", Value: 1}, Name: "Comando (0 parar, 1 partir)"},
				{Table: "holding", Address: 1, Type: "UINT16", Generator: Generator{Kind: "fixed", Value: 4500}, Name: "Referência de frequência"},
				{Table: "input", Address: 0, Type: "UINT16", Generator: Generator{Kind: "sine", Offset: 4500, Amplitude: 30, PeriodMs: 20000}, Name: "Frequência de saída"},
				{Table: "input", Address: 1, Type: "UINT16", Generator: Generator{Kind: "sine", Offset: 112, Amplitude: 6, PeriodMs: 7000}, Name: "Corrente do motor"},
				{Table: "input", Address: 2, Type: "INT16", Generator: Generator{Kind: "sine", Offset: 41, Amplitude: 2, PeriodMs: 60000}, Name: "Temperatura do dissipador"},
				{Table: "input", Address: 3, Type: "UINT32", Generator: Generator{Kind: "counter", Step: 1, IntervalMs: 1000}, Name: "Horas de operação (s)"},
				{Table: "coil", Address: 0, Generator: Generator{Kind: "fixed", Value: 1}, Name: "Habilitado"},
				{Table: "discrete", Address: 0, Generator: Generator{Kind: "fixed", Value: 0}, Name: "Falha"},
			},
		},
		{
			UnitID: 2, Name: "Transmissor de pressão",
			DeviceID: map[byte]string{0: "ModField", 1: "DEMO-PT", 2: "2.0.1"},
			Points: []Point{
				{Table: "holding", Address: 0, Type: "FLOAT32", Order: "CDAB", Generator: Generator{Kind: "sine", Offset: 6.2, Amplitude: 0.4, PeriodMs: 30000}, Name: "Pressão"},
				{Table: "holding", Address: 2, Type: "UINT16", Generator: Generator{Kind: "ramp", Min: 4000, Max: f(20000), PeriodMs: 60000}, Name: "Loop 4–20 mA"},
				{Table: "holding", Address: 10, Type: "STRING", Text: "PT-101 RECALQUE", Generator: Generator{Kind: "fixed"}, Name: "Tag do instrumento"},
			},
		},
		{
			UnitID: 3, Name: "Medidor de vazão",
			Points: []Point{
				{Table: "holding", Address: 100, Type: "FLOAT32", Generator: Generator{Kind: "random", Min: 12.1, Max: f(12.9)}, Name: "Vazão"},
				{Table: "holding", Address: 102, Type: "FLOAT64", Generator: Generator{Kind: "counter", Step: 0.0035, IntervalMs: 1000}, Name: "Totalizador"},
			},
		},
	}
}
