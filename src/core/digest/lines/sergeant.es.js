/**
 * El Sargento, español. Disciplina con cariño, corto y directo (docs/specs/2026-10-morning-partner.md).
 * Written in Spanish, not translated. Neutral Spanish with "tú", no gendered adjectives for the reader.
 * Each line: [subject and opening line, follow-up]. {count}, {weekday}; {item} only in the follow-up.
 * In overdue_few {count} is 1 or 2: write "Atrasados: {count}", never "{count} atrasados".
 * A line's id is its position: add new lines at the end of a list, never reorder or delete.
 */
module.exports = {
  all_clear: [
    ['Cero atrasados. Bien. No te acomodes.', 'Revisa lo nuevo y mantente adelante.'],
    ['Todo al día. Así se hace.', 'Mantenlo así. Mira lo que llegó.'],
    ['Nada atrasado. Excelente. Ahora, atención.', 'Hay cosas nuevas abajo. Atácalas temprano.'],
    ['Sin atrasos. Misión en curso.', 'Revisa lo nuevo antes de que se acumule.'],
    ['{weekday} sin atrasos. Mantén la línea.', 'Esto es lo que llegó. Adelántate.'],
    ['Nada tarde. Eso es disciplina.', 'Mismo estándar hoy. Mira lo nuevo.'],
    ['Todo al día. Ganado, no regalado.', 'Sigue avanzando. Lo nuevo está abajo.'],
    ['Cero atrasados. Ahora sube la vara.', 'Tómate un minuto para ver lo que llegó.']
  ],
  due_today: [
    ['Vence hoy. Listo antes del almuerzo. Sin debate.', 'Ábrelo. Termínalo. Después, café.'],
    ['Un objetivo hoy. Dale.', 'Empieza por: {item}.'],
    ['Plazo hoy. Ojos en eso.', 'Primero: {item}.'],
    ['La misión de hoy está en tu escritorio.', 'Sin calentamiento. Empieza ya.'],
    ['Algo vence hoy. Ya sabes qué hacer.', 'Hazlo antes de la primera reunión.'],
    ['Vence hoy significa hoy. No “después”.', 'Bloquea 30 minutos y ciérralo.'],
    ['Plazo del {weekday}. Concéntrate.', 'Termínalo y después todo lo demás.'],
    ['Hoy se hace. Punto.', 'Empieza por {item}.']
  ],
  overdue_few: [
    ['Atrasados: {count}. No mañana. Hoy.', 'Empieza por {item}.'],
    ['Algo está atrasado. Arréglalo antes del almuerzo.', 'Una hora de foco y queda resuelto.'],
    ['Lo atrasado no mejora con el tiempo. Muévete.', 'Liquida {item} primero.'],
    ['Atrasados: {count}. Pila chica. Despáchala ya.', 'Antes de que crezca, termínala.'],
    ['Hay atraso. Hoy te pones al día.', 'Abre el primero y no pares.'],
    ['Atraso un {weekday}. Inaceptable. Corrígelo.', 'Empieza por {item}.'],
    ['Fuera de plazo. Cierra la brecha hoy.', 'Primer pendiente, a primera hora.'],
    ['Atrasados: {count}. Las excusas no los cierran.', 'Diez minutos ahora valen más que una hora después.']
  ],
  overdue_pile: [
    ['{count} atrasados. Las excusas no entregan nada. Tú sí. Muévete.', 'Empieza por {item}.'],
    ['{count} atrasados. A marchar.', 'Uno a la vez. El primero, ya.'],
    ['{count} atrasados. La pila no se achica sola.', 'Despacha el más antiguo antes de tu primera reunión.'],
    ['{count} atrasados. Hoy salimos del hoyo.', 'Elige uno. Termínalo. Repite.'],
    ['{count} atrasados. Deja de planificar. Empieza a terminar.', 'Parte por {item}.'],
    ['{count} atrasados. Quiero uno listo antes del mediodía.', 'Después el siguiente.'],
    ['{count} atrasados un {weekday}. Dale vuelta.', 'Cierra uno antes de abrir el correo.'],
    ['{count} atrasados. Hoy recuperas el control.', 'Cambia la fecha a los que pueden esperar.']
  ],
  // 6 o más: ordenar y priorizar, nunca presionar (spec, punto 5)
  overloaded: [
    ['{count} atrasados son demasiados para pelearlos juntos. Elige uno.', 'Gánalo. Luego el siguiente. Mueve o descarta el resto.'],
    ['{count} atrasados. Nueva orden: priorizar.', 'Quédate con los 3 que importan. Reprograma el resto.'],
    ['{count} atrasados. Reagrupa antes de atacar.', 'Elige uno que importe y termínalo hoy.'],
    ['{count} atrasados. Nadie limpia eso en un día. Prioriza.', 'Hoy, uno. Al resto, fechas reales.'],
    ['{count} atrasados. Aquí gana la estrategia, no la fuerza.', 'Descarta lo que murió. Ponle fecha a lo que sigue vivo.'],
    ['{count} atrasados. Hay que rehacer el plan.', 'Diez minutos ordenando salvan la semana.'],
    ['{count} atrasados. Batallas más chicas. Elige una.', 'Puede que algunos ni sean tuyos. Revísalo.'],
    ['{count} atrasados. Respira. Después elige uno.', 'Hecho es mejor que perfecto. Reprograma el resto.']
  ],
  prep_only: [
    ['Hoy hay reuniones. Llega con la tarea hecha.', 'Revisa primero los pendientes de abajo.'],
    ['Hora del briefing. Conoce tus pendientes.', 'Cinco minutos ahora salvan la reunión.'],
    ['Hoy no se entra a ciegas.', 'Revisa quién debe qué antes de conectarte.'],
    ['Día de reuniones. Llega con todo claro.', 'Los pendientes están abajo.'],
    ['Reuniones este {weekday}. A prepararse.', 'Revisa la lista. Haz seguimiento a lo pendiente.'],
    ['La preparación gana reuniones.', 'Lee los pendientes antes de la primera llamada.'],
    ['Llegar con todo claro. Ese es el trabajo.', 'Tus notas de preparación están abajo.'],
    ['Reuniones en cola. Ten los datos claros.', 'Pendientes con estas personas, abajo.']
  ]
};
