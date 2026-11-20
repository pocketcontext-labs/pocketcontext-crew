// The selection mode and recipient are frozen with the review options.
migrate(
  (app) => {
    const reviews = app.findCollectionByNameOrId("crew_reviews");
    reviews.fields.getByName("draft").required = false;
    reviews.fields.add(
      new SelectField({
        name: "selection",
        values: ["any", "one"],
        maxSelect: 1,
      }),
    );
    reviews.fields.add(new TextField({ name: "recipient", max: 200 }));
    app.save(reviews);
    app
      .db()
      .newQuery(
        "UPDATE crew_reviews SET selection = 'any' WHERE selection = ''",
      )
      .execute();
  },
  () => {
    throw new Error(
      "Restore the complete pre-upgrade backup to roll back review selection",
    );
  },
);
