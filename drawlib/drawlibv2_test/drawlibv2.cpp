#include <drawlib/drawlibv2/allincludes.h>


#include <blex/path.h>
#include <blex/utils.h>
#include <blex/testing.h>
#include <cstdlib>
#include <ctime>

//------------------------------------------------------------------------------
int UTF8Main(std::vector<std::string> const &args)
{
        if(args.size()<2)
                throw std::runtime_error("Syntax: drawlibv2 <testdir>");

        Blex::Test::SetTestDataDir(args[1]);
        Blex::Test::SetTestName("drawlibv2");
        if (Blex::Test::Run(Blex::Test::TestNoisy, "*"))
        {
                return EXIT_SUCCESS;
        }
        else
        {
                std::cerr << "Look for errors in " << Blex::Test::GetTempDir() << "\n";
                return EXIT_FAILURE;
        }
 }

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
                return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

