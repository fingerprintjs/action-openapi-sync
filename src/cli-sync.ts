async function run(): Promise<void> {

}

run().catch((error: unknown) => {
  console.error('Fatal error: ', error)
  process.exit(1)
})
